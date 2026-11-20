/**
 * DailyTalkContentGenerator.gs
 *
 * Ryan Daily Talk content generation.
 *
 *   settings (설정)  ->  OpenAI Responses API (JSON schema, one request per track)
 *   ->  validation  ->  append a row to 콘텐츠대기열 in the existing column layout
 *   ->  the publication + send pipeline (DailyTalkWixPublisher.gs) takes it from there.
 *
 * Rules:
 *  - The OpenAI key comes only from Script Properties (OPENAI_API_KEY); it is
 *    never written to a sheet, a log line or a response.
 *  - Generation never sends a message. It only writes queue rows.
 *  - AUTO_GENERATE / TRACKS_TO_GENERATE / DEFAULT_LEVEL / OPENAI_MODEL /
 *    AUTO_APPROVE are read from the 설정 sheet; the constants here are only
 *    defaults for when a setting row is missing.
 *  - A track that already has a row for the day is not generated again
 *    (idempotent daily runs); pass force:true to override.
 *  - Pure helpers (prompt, schema, parsing, validation, row layout) have no
 *    Google service calls and are covered by tests/daily-talk-generator.test.js.
 *
 * Lesson shape (2026-11-20, the academy's five steps; step 5 differs by track):
 *   STEP 1  words     3 words / expressions with their Korean meaning
 *   STEP 2  sentences 3 Korean sentences built from those words
 *   STEP 3  sentences[].order  the same Korean sentences cut up and reordered
 *          into English word order (누가 / 한다 / 무엇을 / 어디서 / 언제)
 *   STEP 4  sentences[].en     the same sentences in natural English
 *   STEP 5  SMALL_TALK  aaa           one of those sentences said in a real
 *          conversation as Answer -> Add -> Ask
 *          BUSINESS    messageHouse  one of those sentences grown into the
 *          message a Korean office worker really sends: Conclusion (the point
 *          first) -> Reason -> Detail -> Suggestion when a next step is needed
 *          (3 or 4 sentences)
 * Storage keeps the existing queue columns: CHUNKS_JSON <- words,
 * WORD_ORDER_JSON <- sentences, STRUCTURE_JSON <- the step 5 script (type AAA
 * or MESSAGE_HOUSE), MODEL_EN/KO <- the same lines as labelled text. No sheet
 * migration is needed, and rows written before today keep their AAA shape.
 */

var RM_DAILY_TALK_GEN = Object.freeze({
  OPENAI_RESPONSES_URL: 'https://api.openai.com/v1/responses',
  OPENAI_MODELS_URL: 'https://api.openai.com/v1/models',
  DEFAULT_MODEL: 'gpt-5.5',
  FALLBACK_MODELS: ['gpt-5.5', 'gpt-5.4', 'gpt-5.5-2026-04-23', 'gpt-4.1'],
  REASONING_EFFORT: 'low',
  MAX_OUTPUT_TOKENS: 2200,
  ATTEMPTS_PER_MODEL: 2,
  RETRY_DELAY_MS: 1500,
  RECENT_TOPIC_LOOKBACK: 12,
  DEFAULT_LEVEL: 'BASIC',
  STATUS_DRAFT: 'DRAFT',
  STATUS_APPROVED: 'APPROVED',
  STATUS_TEST: 'TEST',
  SOURCE_PREFIX: 'OPENAI:',
  QUEUE_HEADER_ROW: 3,
  QUEUE_HEADERS: [
    'CONTENT_ID', '발송일', '트랙', '레벨', '상태',
    'TOPIC_EN', 'TOPIC_KO', 'SNACK_EN', 'SNACK_KO', 'CHUNKS_JSON',
    'MODEL_EN', 'MODEL_KO', 'YOUR_TURN_EN', 'YOUR_TURN_KO', 'SOURCES',
    '카카오본문', '생성시각', '발송시각', '오류'
  ],
  // Columns the publication step writes; added only when a sheet lacks them.
  PUBLISH_HEADERS: ['WIX_CONTENT_URL', 'WIX_POST_ID', 'WIX_PUBLISHED_AT', 'KAKAO_LINK_SENT_AT'],
  // The Ryan Members lesson columns. These columns are added to an existing
  // 콘텐츠대기열 by ensureQueueHeaderColumns_ and read by the Wix publisher.
  STEP_HEADERS: ['WORD_ORDER_JSON', 'STRUCTURE_JSON', 'SUBSTITUTIONS_JSON'],
  TEXT_FIELDS: ['topicEn', 'topicKo', 'snackEn', 'snackKo'],
  // The fields every card has; step 5 adds `aaa` (small talk) or
  // `messageHouse` (business) — see dailyTalkContentFields().
  CONTENT_FIELDS: ['topicEn', 'topicKo', 'snackEn', 'snackKo', 'words', 'sentences'],
  // Step 1 teaches three words; steps 2-4 walk the same three sentences, and
  // step 5 grows out of one of them.
  WORD_COUNT: 3,
  SENTENCE_COUNT: 3,
  MIN_ORDER_PIECES: 2,
  MAX_ORDER_PIECES: 6
});

/**
 * STEP 3 splits a Korean sentence into meaning pieces and lays them out in
 * English word order: 누가 (who) / 한다 (does) / 무엇을 (what) / 어디서 (where) /
 * 언제 (when) / 어떻게 (how).
 */
var RM_DAILY_TALK_ROLES = Object.freeze(['누가', '한다', '무엇을', '어디서', '언제', '어떻게']);

/** STEP 5 for SMALL_TALK: Answer -> Add -> Ask. */
var RM_DAILY_TALK_AAA = Object.freeze({
  TYPE: 'AAA',
  STEPS: [
    { key: 'answer', label: 'Answer', hint: '한 문장으로 먼저 답하기' },
    { key: 'add', label: 'Add', hint: '이유나 디테일을 한 문장 더하기' },
    { key: 'ask', label: 'Ask', hint: '상대에게 되묻기' }
  ]
});

/**
 * STEP 5 for BUSINESS: a Top-Down Message House. Conclusion first, then the
 * reason it holds, one concrete detail, and — only when the situation needs a
 * next step — a suggestion. Suggestion is asked for but may come back empty,
 * so a business card is 3 or 4 sentences.
 */
var RM_DAILY_TALK_MESSAGE_HOUSE = Object.freeze({
  TYPE: 'MESSAGE_HOUSE',
  STEPS: [
    { key: 'conclusion', label: 'Conclusion', hint: '핵심 결론부터 말하기' },
    { key: 'reason', label: 'Reason', hint: '근거 기둥 세우기' },
    { key: 'detail', label: 'Detail', hint: '구체적인 디테일 붙이기' },
    { key: 'suggestion', label: 'Suggestion', hint: '다음 행동 제안하기', optional: true }
  ]
});

/** The practice cue stored in YOUR_TURN_* (the CMS keeps the field non-empty). */
var RM_DAILY_TALK_PRACTICE_CUE = Object.freeze({
  en: 'Say your Answer, Add and Ask out loud three times today.',
  ko: '오늘 Answer → Add → Ask 세 문장을 소리 내어 세 번 말해 보세요.'
});

var RM_DAILY_TALK_PRACTICE_CUES = Object.freeze({
  AAA: RM_DAILY_TALK_PRACTICE_CUE,
  MESSAGE_HOUSE: Object.freeze({
    en: 'Say your business message out loud three times today: Conclusion first, then Reason, Detail and Suggestion.',
    ko: '오늘 업무 메시지를 소리 내어 세 번 말해 보세요. 결론 → 근거 → 디테일, 필요하면 제안까지.'
  })
});

/**
 * Step 5 labels by structure type. Kept as one table because the queue's
 * STRUCTURE_JSON, the CMS body and the article renderer all read it.
 */
var RM_DAILY_TALK_STRUCTURE_LABELS = Object.freeze({
  AAA: RM_DAILY_TALK_AAA.STEPS.map(function (step) { return step.label; }),
  MESSAGE_HOUSE: RM_DAILY_TALK_MESSAGE_HOUSE.STEPS.map(function (step) { return step.label; })
});

function dailyTalkStructureTypeFor(track) {
  return normalizeTrack(track) === RM_TRACKS.BUSINESS ? 'MESSAGE_HOUSE' : 'AAA';
}

function dailyTalkStructureLabels(type) {
  return RM_DAILY_TALK_STRUCTURE_LABELS[type === 'MESSAGE_HOUSE' ? 'MESSAGE_HOUSE' : 'AAA'];
}

/** STEP 5 steps of a structure type: [{key, label, hint, optional?}]. */
function dailyTalkStructureSteps(type) {
  return (type === 'MESSAGE_HOUSE' ? RM_DAILY_TALK_MESSAGE_HOUSE : RM_DAILY_TALK_AAA).STEPS;
}

var RM_DAILY_TALK_TRACK_BRIEFS = Object.freeze({
  SMALL_TALK: 'Daily Small Talk: everyday conversation an adult learner can use the same day ' +
    '(greetings, weekends, food and cafes, weather, hobbies, travel, neighbours, delivery, small talk with coworkers).',
  BUSINESS: 'Daily Business Talk: workplace English for Korean office workers ' +
    '(meetings, email openers and follow-ups, deadlines, polite requests, status updates, negotiation, presenting, workplace small talk).'
});

// ---------------------------------------------------------------------------
// Pure layer — no Google services, safe to unit test
// ---------------------------------------------------------------------------

/** 'SMALL_TALK,BUSINESS' -> ['SMALL_TALK','BUSINESS']; BOTH means both tracks. */
function parseTrackList(value) {
  var raw = String(value === null || value === undefined ? '' : value).trim();
  if (!raw) return [RM_TRACKS.SMALL_TALK, RM_TRACKS.BUSINESS];
  var out = [];
  raw.split(/[,/|;]+/).forEach(function (token) {
    var track = normalizeTrack(token);
    if (!track) return;
    if (track === RM_TRACKS.BOTH) {
      if (out.indexOf(RM_TRACKS.SMALL_TALK) === -1) out.push(RM_TRACKS.SMALL_TALK);
      if (out.indexOf(RM_TRACKS.BUSINESS) === -1) out.push(RM_TRACKS.BUSINESS);
      return;
    }
    if (out.indexOf(track) === -1) out.push(track);
  });
  return out.length ? out : [RM_TRACKS.SMALL_TALK, RM_TRACKS.BUSINESS];
}

/** Pairs of {"en", "ko"} — a word (STEP 1) or one AAA line (STEP 5). */
function buildDailyTalkPairSchema_() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['en', 'ko'],
    properties: {
      en: { type: 'string' },
      ko: { type: 'string' }
    }
  };
}

/** Required JSON fields of a card for a structure type. */
function dailyTalkContentFields(structureType) {
  var step5 = structureType === 'MESSAGE_HOUSE' ? 'messageHouse' : 'aaa';
  return RM_DAILY_TALK_GEN.CONTENT_FIELDS.concat([step5]);
}

/**
 * JSON schema for one Daily Talk item (Responses API structured output).
 * structureType picks the step 5 object: `aaa` (Answer / Add / Ask) or
 * `messageHouse` (Conclusion / Reason / Detail / Suggestion).
 */
function buildDailyTalkContentSchema(structureType) {
  var pieceSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['role', 'text'],
    properties: {
      role: { type: 'string', enum: RM_DAILY_TALK_ROLES.slice() },
      text: { type: 'string' }
    }
  };
  var sentenceSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['ko', 'order', 'en'],
    properties: {
      ko: { type: 'string' },
      order: {
        type: 'array',
        minItems: RM_DAILY_TALK_GEN.MIN_ORDER_PIECES,
        maxItems: RM_DAILY_TALK_GEN.MAX_ORDER_PIECES,
        items: pieceSchema
      },
      en: { type: 'string' }
    }
  };
  var pair = buildDailyTalkPairSchema_();
  var type = structureType === 'MESSAGE_HOUSE' ? 'MESSAGE_HOUSE' : 'AAA';

  var properties = {
    topicEn: { type: 'string' },
    topicKo: { type: 'string' },
    snackEn: { type: 'string' },
    snackKo: { type: 'string' },
    words: {
      type: 'array',
      minItems: RM_DAILY_TALK_GEN.WORD_COUNT,
      maxItems: RM_DAILY_TALK_GEN.WORD_COUNT,
      items: pair
    },
    sentences: {
      type: 'array',
      minItems: RM_DAILY_TALK_GEN.SENTENCE_COUNT,
      maxItems: RM_DAILY_TALK_GEN.SENTENCE_COUNT,
      items: sentenceSchema
    }
  };

  if (type === 'MESSAGE_HOUSE') {
    properties.messageHouse = {
      type: 'object',
      additionalProperties: false,
      required: ['pick', 'conclusion', 'reason', 'detail', 'suggestion'],
      properties: {
        pick: { type: 'integer', minimum: 1, maximum: RM_DAILY_TALK_GEN.SENTENCE_COUNT },
        conclusion: pair,
        reason: pair,
        detail: pair,
        // Required by the schema, but both strings are empty when a next step
        // is not needed; normalizeGeneratedContent drops empty pairs.
        suggestion: pair
      }
    };
  } else {
    properties.aaa = {
      type: 'object',
      additionalProperties: false,
      required: ['pick', 'answer', 'add', 'ask'],
      properties: {
        pick: { type: 'integer', minimum: 1, maximum: RM_DAILY_TALK_GEN.SENTENCE_COUNT },
        answer: pair,
        add: pair,
        ask: pair
      }
    };
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: dailyTalkContentFields(type),
    properties: properties
  };
}

/**
 * Builds the system/user prompt for one track.
 * options: { date, level, recentTopics: ['topic', ...], seed }
 */
function buildContentPrompt(track, options) {
  var opts = options || {};
  var normalizedTrack = normalizeTrack(track) === RM_TRACKS.BUSINESS ? RM_TRACKS.BUSINESS : RM_TRACKS.SMALL_TALK;
  var brief = RM_DAILY_TALK_TRACK_BRIEFS[normalizedTrack];
  var level = String(opts.level || RM_DAILY_TALK_GEN.DEFAULT_LEVEL).trim().toUpperCase();
  var recent = (opts.recentTopics || []).filter(Boolean).slice(0, RM_DAILY_TALK_GEN.RECENT_TOPIC_LOOKBACK);
  var seed = String(opts.seed || '').trim();
  var isBusiness = normalizedTrack === RM_TRACKS.BUSINESS;
  // Step 5 is small talk's AAA and business's Top-Down Message House.
  var structureType = dailyTalkStructureTypeFor(normalizedTrack);
  var messageHouse = structureType === 'MESSAGE_HOUSE';

  var system = [
    'You write Ryan Daily Talk, the weekday English-learning card that Ryan Members, an English conversation academy in Busan,',
    'sends to Korean adult learners on KakaoTalk. Brand line: "English Opens a New World."',
    'The reader is a busy Korean adult at ' + level + ' level (CEFR A2-B1): they understand everyday English but',
    'freeze when they have to speak. Write warm, practical, natural English they can actually say today.',
    '',
    'Every card teaches ONE situation in five steps, in this exact order:',
    'Step 1 Key words: three words or expressions of the day, each with its Korean meaning.',
    'Step 2 Korean sentences: three Korean sentences that use those words.',
    'Step 3 English word order: the same three Korean sentences, cut into meaning pieces and rearranged into English word order',
    '(누가 / 한다 / 무엇을 / 어디서 / 언제), so the learner stops translating word for word from Korean.',
    'Step 4 English sentences: the same three sentences translated into natural spoken English.',
    messageHouse
      ? 'Step 5 Message House: pick ONE of the three sentences and grow it into the business message the learner really sends or says at work —'
      : 'Step 5 AAA: pick ONE of the three sentences and show how the learner says it in a real conversation in three sentences —',
    messageHouse
      ? 'three sentences, or four when a next step is needed: Conclusion (say the point first), Reason (why it holds), Detail (one concrete fact), Suggestion (the next step as a proposal or a question).'
      : 'Answer (answer in one sentence), Add (one reason or detail), Ask (ask back and hand the turn over).',
    isBusiness
      ? 'This card is BUSINESS TALK: a workplace exchange. Every sentence is what the learner would really say to a colleague, a client or a manager.'
      : 'This card is SMALL TALK: friendly everyday conversation the learner can have today.',
    '',
    'The five steps must all point at the same three sentences: the words of Step 1 are the words used in Steps 2-4,',
    'and Step 5 grows out of the sentence it picks.',
    'Never use markdown, emoji, hashtags or quotation marks around whole fields. Return JSON only.'
  ].join('\n');

  var lines = [
    'Track: ' + brief,
    'Learner level: ' + level,
    (opts.date ? 'Send date: ' + opts.date : ''),
    (seed ? 'Topic seed (use it or a close variation): ' + seed : ''),
    recent.length ? 'Do NOT reuse these recent topics: ' + recent.join(' | ') : '',
    '',
    'One situation, one lesson. Fill every field of the JSON schema:',
    '- topicEn: a short catchy English title, 2-6 words, no ending period.',
    '- topicKo: the same title in natural Korean (no English parentheses).',
    '- snackEn: 2 sentences (max 40 words) that set today\'s situation and name what today\'s lesson is about.',
    '- snackKo: a faithful, natural Korean translation of snackEn.',
    '- words: exactly ' + RM_DAILY_TALK_GEN.WORD_COUNT + ' items. Each has "en" (the word or expression as it is said, max 5 words)',
    '  and "ko" (its meaning in Korean, dictionary style: 나는 마신다 / 따뜻한 커피 / 출근길에).',
    '  Pick words the three sentences below really use, and that the learner can reuse in other sentences today.',
    '- sentences: exactly ' + RM_DAILY_TALK_GEN.SENTENCE_COUNT + ' items, one per learning sentence, in the order the learner meets them:',
    '  "ko" = one natural Korean sentence that uses at least one of the words (max 20 words).',
    '  "order" = the SAME Korean sentence cut into meaning pieces and rearranged into English word order.',
    '  Each piece is {role / text}: role is one of 누가 (who), 한다 (does), 무엇을 (what), 어디서 (where),',
    '  언제 (when), 어떻게 (how); text is that piece in Korean, exactly as it appears in "ko".',
    '  Use ' + RM_DAILY_TALK_GEN.MIN_ORDER_PIECES + '-' + RM_DAILY_TALK_GEN.MAX_ORDER_PIECES + ' pieces, always include 누가 and 한다, and place them 누가 → 한다 → 무엇을 → 어디서 → 언제 order.',
    '  Example for 나는 오늘 아침 출근길에 따뜻한 커피를 마셨다: 누가/나는, 한다/마셨다, 무엇을/따뜻한 커피를, 어디서/출근길에, 언제/오늘 아침.',
    '  Never use the "/" character inside a piece.',
    '  "en" = that same sentence in natural spoken English (max 16 words, contractions).'
  ];

  if (messageHouse) {
    lines = lines.concat([
      '- messageHouse: pick ONE of the three sentences ("pick": 1, 2 or 3 — the one this workplace message grows out of)',
      '  and turn it into the message the learner actually sends or says at work:',
      '  "conclusion" = Conclusion: the point in one sentence, said first (max 20 words);',
      '  "reason" = Reason: the one reason the point holds (max 20 words);',
      '  "detail" = Detail: one concrete fact — a date, a number, a screen or a person (max 20 words);',
      '  "suggestion" = Suggestion: one sentence proposing the next step or asking for a decision —',
      '  or put "" in both "en" and "ko" when this situation needs no next step.',
      '  Each of conclusion / reason / detail / suggestion has "en" and "ko".',
      '  All together that is 3 sentences (no suggestion) or 4 sentences (with suggestion) — never more.'
    ]);
  } else {
    lines = lines.concat([
      '- aaa: pick ONE of the three sentences ("pick": 1, 2 or 3 — the one that best opens a real conversation today)',
      '  and expand it into the three sentences the learner actually says:',
      '  "answer" = Answer: one short sentence that answers or states the picked sentence conversationally;',
      '  "add" = Add: one sentence adding a reason or a concrete detail;',
      '  "ask" = Ask: one sentence asking the other person and handing the turn back.',
      '  Each of answer / add / ask has "en" and "ko".'
    ]);
  }

  lines = lines.concat([
    '',
    'Hard rules:',
    '- At least two of the three words must visibly appear in the three English sentences (sentences[].en).',
    messageHouse
      ? '- The Conclusion must be built on the picked sentence: keep its key words so the learner hears the same expression again.'
      : '- The answer must be built on the picked sentence: keep its key words so the learner hears the same expression again.',
    messageHouse
      ? '- The Message House must reuse at least one of the three words of Step 1, so the card stays one lesson.'
      : '',
    '- The pieces of "order" must be the Korean words of "ko" itself — the meaning does not change, only the order.',
    '- Each "en" is the translation of its own "ko": same meaning, same length, no extra ideas.',
    '- Write spoken English: use contractions (I\'m, it\'s, we\'ll, don\'t) and avoid textbook stiffness.',
    '- English fields contain English only (no Hangul). Korean fields contain Korean (Hangul) only.',
    '- Keep every expression polite and safe for a workplace and a family chat.',
    '- No brand names, no prices, no politics, no religion, no medical or legal advice.',
    '- The topic must be different from the recent topics above and useful this week.'
  ].filter(function (line, index, all) { return line !== '' || all[index - 1] !== ''; }));

  return {
    track: normalizedTrack,
    level: level,
    structureType: structureType,
    schemaName: 'ryan_daily_talk_' + normalizedTrack.toLowerCase(),
    schema: buildDailyTalkContentSchema(structureType),
    system: system,
    user: lines.join('\n')
  };
}

/** Pulls the assistant text out of a Responses API (or Chat Completions) body. */
function extractOpenAiText(payload) {
  if (!payload) return '';
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();

  if (Array.isArray(payload.choices) && payload.choices.length) {
    var message = payload.choices[0] && payload.choices[0].message;
    if (message && typeof message.content === 'string') return message.content.trim();
    if (message && Array.isArray(message.content)) {
      return message.content.map(function (part) { return part && part.text ? part.text : ''; }).join('').trim();
    }
  }

  var parts = [];
  (payload.output || []).forEach(function (item) {
    if (!item) return;
    if (Array.isArray(item.content)) {
      item.content.forEach(function (part) {
        if (part && typeof part.text === 'string') parts.push(part.text);
      });
    } else if (typeof item.text === 'string') {
      parts.push(item.text);
    }
  });
  return parts.join('').trim();
}

/** Parses model JSON, tolerating code fences and stray prose. */
function parseGeneratedContent(text) {
  var raw = String(text === null || text === undefined ? '' : text).trim();
  if (!raw) return null;
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  var direct = safeJsonParse(raw, null);
  if (direct && typeof direct === 'object') return direct;
  var start = raw.indexOf('{');
  var end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return safeJsonParse(raw.slice(start, end + 1), null);
}

function cleanText_(value, options) {
  var keepLines = !!(options && options.keepLines);
  var text = String(value === null || value === undefined ? '' : value).replace(/\r\n?/g, '\n');
  var lines = text.split('\n').map(function (line) {
    return line.replace(/[ \t\u00a0]+/g, ' ').trim();
  });
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  var joined = (keepLines ? lines.join('\n').replace(/\n{2,}/g, '\n') : lines.join(' ')).trim();
  return joined.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
}

/** Trims and coerces a parsed model object into the queue's field shape. */
function normalizeGeneratedContent(parsed, context) {
  var raw = parsed || {};
  var ctx = context || {};
  var track = normalizeTrack(ctx.track) === RM_TRACKS.BUSINESS ? RM_TRACKS.BUSINESS : RM_TRACKS.SMALL_TALK;
  var sentences = (Array.isArray(raw.sentences) ? raw.sentences : []).map(function (row) {
    if (typeof row === 'string') return { ko: cleanText_(row), order: [], en: '' };
    return {
      ko: cleanText_(row && row.ko),
      order: parseOrderPieces_(row && row.order),
      en: cleanText_(row && row.en)
    };
  });

  // Step 5's shape follows the payload, so a business row that came back in
  // the small-talk AAA shape (or an old row) still validates and stores.
  var hasMessageHouse = !!(raw.messageHouse && typeof raw.messageHouse === 'object');
  var hasAaa = !!(raw.aaa && typeof raw.aaa === 'object');
  var structureType = hasMessageHouse ? 'MESSAGE_HOUSE' : (hasAaa ? 'AAA' : dailyTalkStructureTypeFor(track));

  return {
    track: track,
    level: String(ctx.level || RM_DAILY_TALK_GEN.DEFAULT_LEVEL).trim().toUpperCase(),
    structureType: structureType,
    topicEn: cleanText_(raw.topicEn),
    topicKo: cleanText_(raw.topicKo),
    snackEn: cleanText_(raw.snackEn),
    snackKo: cleanText_(raw.snackKo),
    words: (Array.isArray(raw.words) ? raw.words : []).map(function (word) {
      return normalizeDailyTalkPair_(word);
    }),
    sentences: sentences,
    aaa: {
      pick: Number((raw.aaa && raw.aaa.pick) || 0) || 0,
      answer: normalizeDailyTalkPair_(raw.aaa && raw.aaa.answer),
      add: normalizeDailyTalkPair_(raw.aaa && raw.aaa.add),
      ask: normalizeDailyTalkPair_(raw.aaa && raw.aaa.ask)
    },
    messageHouse: normalizeDailyTalkMessageHouse_(raw.messageHouse)
  };
}

/** {pick, conclusion, reason, detail, suggestion} — every pair trimmed. */
function normalizeDailyTalkMessageHouse_(raw) {
  var value = raw && typeof raw === 'object' ? raw : {};
  return {
    pick: Number(value.pick || 0) || 0,
    conclusion: normalizeDailyTalkPair_(value.conclusion),
    reason: normalizeDailyTalkPair_(value.reason),
    detail: normalizeDailyTalkPair_(value.detail),
    suggestion: normalizeDailyTalkPair_(value.suggestion)
  };
}

/** {en, ko} from an object, or an English-only string. */
function normalizeDailyTalkPair_(value) {
  if (typeof value === 'string') return { en: cleanText_(value), ko: '' };
  return { en: cleanText_(value && value.en), ko: cleanText_(value && value.ko) };
}

/**
 * STEP 3 pieces: [{role, text}]. Accepts the array the schema asks for and,
 * as a fallback, the "누가: 나는 / 한다: 마셨다" string a model sometimes sends.
 */
function parseOrderPieces_(value) {
  if (Array.isArray(value)) {
    return value.map(function (piece) {
      if (typeof piece === 'string') return { role: '', text: cleanText_(piece) };
      return {
        role: cleanText_(piece && piece.role),
        text: cleanText_(piece && piece.text)
      };
    }).filter(function (piece) { return piece.role || piece.text; });
  }
  var text = String(value === null || value === undefined ? '' : value);
  if (!text.trim()) return [];
  return text.split(/\s*\/\s*|\s*\|\s*/).map(function (part) {
    var matched = new RegExp('^(' + RM_DAILY_TALK_ROLES.join('|') + ')\\s*[:：]\\s*(.+)$').exec(part.trim());
    if (matched) return { role: matched[1], text: cleanText_(matched[2]) };
    return { role: '', text: cleanText_(part) };
  }).filter(function (piece) { return piece.role || piece.text; });
}

var RM_HANGUL_PATTERN = /[\uAC00-\uD7A3]/;
var RM_LATIN_PATTERN = /[A-Za-z]/;

/** Words that say nothing about which sentence a piece belongs to. */
var RM_ENGLISH_LINK_STOPWORDS = {
  this: true, that: true, with: true, have: true, has: true, had: true, what: true,
  your: true, you: true, from: true, they: true, them: true, there: true, here: true,
  just: true, like: true, some: true, very: true, really: true, because: true, about: true,
  would: true, could: true, should: true, been: true, were: true, will: true, going: true,
  want: true, that_s: true
};

/** Lowercase words of English text, punctuation dropped. */
function dailyTalkEnglishTokens_(value) {
  return String(value === null || value === undefined ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Does this word (or its stem) appear in the English sentences? */
function dailyTalkWordAppearsIn_(word, text) {
  var tokens = dailyTalkEnglishTokens_(word);
  if (!tokens.length) return true;
  var head = tokens[0];
  var stem = head.length > 4 ? head.slice(0, Math.max(4, head.length - 2)) : head;
  if (!stem) return true;
  return (' ' + dailyTalkEnglishTokens_(text).join(' ') + ' ').indexOf(' ' + stem) !== -1;
}

/** Two sentences share a content word (4+ letters, not a stopword). */
function dailyTalkSentencesShareWord_(left, right) {
  var rightWords = {};
  dailyTalkEnglishTokens_(right).forEach(function (token) {
    if (token.length < 4 || RM_ENGLISH_LINK_STOPWORDS[token]) return;
    rightWords[token] = true;
    rightWords[token.replace(/s$/, '')] = true;
  });
  return dailyTalkEnglishTokens_(left).some(function (token) {
    if (token.length < 4 || RM_ENGLISH_LINK_STOPWORDS[token]) return false;
    return !!rightWords[token] || !!rightWords[token.replace(/s$/, '')];
  });
}

/** Field-level validation; returns {ok, errors:[{field, message}]}. */
function validateGeneratedContent(content) {
  var value = content || {};
  var errors = [];
  function fail(field, message) { errors.push({ field: field, message: message }); }

  RM_DAILY_TALK_GEN.TEXT_FIELDS.forEach(function (field) {
    if (!String(value[field] || '').trim()) fail(field, '비어 있습니다.');
  });

  ['topicEn', 'snackEn'].forEach(function (field) {
    var text = String(value[field] || '');
    if (text && RM_HANGUL_PATTERN.test(text)) fail(field, '영어 필드에 한글이 있습니다.');
    if (text && !RM_LATIN_PATTERN.test(text)) fail(field, '영어 필드에 영어가 없습니다.');
  });

  ['topicKo', 'snackKo'].forEach(function (field) {
    var text = String(value[field] || '');
    if (text && !RM_HANGUL_PATTERN.test(text)) fail(field, '한글 필드에 한글이 없습니다.');
  });

  if (String(value.topicEn || '').length > 70) fail('topicEn', '제목이 너무 깁니다.');
  if (String(value.topicKo || '').length > 60) fail('topicKo', '제목이 너무 깁니다.');
  if (String(value.snackEn || '').split(/\s+/).filter(Boolean).length > 70) fail('snackEn', '스낵 설명이 너무 깁니다.');

  validateDailyTalkWords_(value.words, fail);
  validateDailyTalkSentences_(value.sentences, fail);
  if (dailyTalkStructureTypeOf_(value) === 'MESSAGE_HOUSE') {
    validateDailyTalkMessageHouse_(value.messageHouse, fail);
  } else {
    validateDailyTalkAaa_(value.aaa, fail);
  }
  validateDailyTalkStepLinks_(value, fail);

  return { ok: errors.length === 0, errors: errors };
}

/** The structure type a content object carries; AAA when it is unset. */
function dailyTalkStructureTypeOf_(content) {
  var value = content || {};
  if (value.structureType === 'MESSAGE_HOUSE') return 'MESSAGE_HOUSE';
  if (value.structureType === 'AAA') return 'AAA';
  if (value.messageHouse && !value.aaa) return 'MESSAGE_HOUSE';
  return 'AAA';
}

/** STEP 1: exactly three words, each an English word/expression with a Korean meaning. */
function validateDailyTalkWords_(rows, fail) {
  var list = Array.isArray(rows) ? rows : [];
  if (list.length !== RM_DAILY_TALK_GEN.WORD_COUNT) {
    fail('words', '단어는 ' + RM_DAILY_TALK_GEN.WORD_COUNT + '개여야 합니다.');
  }
  list.forEach(function (row, index) {
    var prefix = 'words[' + index + ']';
    var en = String((row && row.en) || '');
    var ko = String((row && row.ko) || '');
    if (!en.trim()) fail(prefix + '.en', '영어 단어가 비어 있습니다.');
    if (!ko.trim()) fail(prefix + '.ko', '한글 뜻이 비어 있습니다.');
    if (en && RM_HANGUL_PATTERN.test(en)) fail(prefix + '.en', '영어 단어에 한글이 있습니다.');
    if (en && !RM_LATIN_PATTERN.test(en)) fail(prefix + '.en', '영어 단어에 영어가 없습니다.');
    if (en && en.split(/\s+/).filter(Boolean).length > 5) fail(prefix + '.en', '단어가 너무 깁니다.');
    if (ko && !RM_HANGUL_PATTERN.test(ko)) fail(prefix + '.ko', '한글 뜻에 한글이 없습니다.');
  });
}

/** STEP 2-4: three sentences, each Korean -> English word order -> English. */
function validateDailyTalkSentences_(rows, fail) {
  var list = Array.isArray(rows) ? rows : [];
  if (list.length !== RM_DAILY_TALK_GEN.SENTENCE_COUNT) {
    fail('sentences', '문장은 ' + RM_DAILY_TALK_GEN.SENTENCE_COUNT + '개여야 합니다.');
  }
  list.forEach(function (row, index) {
    var prefix = 'sentences[' + index + ']';
    var ko = String((row && row.ko) || '');
    var en = String((row && row.en) || '');
    if (!ko.trim()) fail(prefix + '.ko', '한국어 문장이 비어 있습니다.');
    if (!en.trim()) fail(prefix + '.en', '영어 문장이 비어 있습니다.');
    if (ko && !RM_HANGUL_PATTERN.test(ko)) fail(prefix + '.ko', '한국어 문장에 한글이 없습니다.');
    if (en && RM_HANGUL_PATTERN.test(en)) fail(prefix + '.en', '영어 문장에 한글이 있습니다.');
    if (en && !RM_LATIN_PATTERN.test(en)) fail(prefix + '.en', '영어 문장에 영어가 없습니다.');
    if (en && en.split(/\s+/).filter(Boolean).length > 20) fail(prefix + '.en', '영어 문장이 너무 깁니다.');

    var pieces = Array.isArray(row && row.order) ? row.order : [];
    if (pieces.length < RM_DAILY_TALK_GEN.MIN_ORDER_PIECES || pieces.length > RM_DAILY_TALK_GEN.MAX_ORDER_PIECES) {
      fail(prefix + '.order', '어순 조각은 ' + RM_DAILY_TALK_GEN.MIN_ORDER_PIECES + '~' + RM_DAILY_TALK_GEN.MAX_ORDER_PIECES + '개여야 합니다.');
    }
    var roleSeen = {};
    var roleIndex = [];
    pieces.forEach(function (piece, pieceIndex) {
      var at = prefix + '.order[' + pieceIndex + ']';
      var role = String((piece && piece.role) || '').trim();
      var text = String((piece && piece.text) || '').trim();
      if (RM_DAILY_TALK_ROLES.indexOf(role) === -1) {
        fail(at + '.role', '역할은 ' + RM_DAILY_TALK_ROLES.join('/') + ' 중 하나여야 합니다.');
      }
      if (!text) fail(at + '.text', '조각이 비어 있습니다.');
      if (text && !RM_HANGUL_PATTERN.test(text)) fail(at + '.text', '조각에 한글이 없습니다.');
      if (text && text.indexOf('/') !== -1) fail(at + '.text', '조각에 "/"가 있습니다.');
      roleSeen[role] = true;
      roleIndex.push(RM_DAILY_TALK_ROLES.indexOf(role));
    });
    if (pieces.length) {
      if (!roleSeen['누가']) fail(prefix + '.order', '누가 조각이 없습니다.');
      if (!roleSeen['한다']) fail(prefix + '.order', '한다 조각이 없습니다.');
      var who = roleIndex.indexOf(0);
      var does = roleIndex.indexOf(1);
      if (who !== -1 && does !== -1 && who > does) fail(prefix + '.order', '누가가 한다보다 먼저 와야 합니다.');
    }
  });
}

/** STEP 5: one picked sentence said as Answer -> Add -> Ask. */
function validateDailyTalkAaa_(value, fail) {
  var aaa = value || {};
  var pick = Number(aaa.pick || 0);
  if (!(pick >= 1 && pick <= RM_DAILY_TALK_GEN.SENTENCE_COUNT)) {
    fail('aaa.pick', '고른 문장 번호가 1~' + RM_DAILY_TALK_GEN.SENTENCE_COUNT + '이어야 합니다.');
  }
  RM_DAILY_TALK_AAA.STEPS.forEach(function (step) {
    validateDailyTalkPair_(aaa[step.key], 'aaa.' + step.key, fail, true);
  });
}

/**
 * STEP 5 for business: Conclusion -> Reason -> Detail -> (Suggestion).
 * Suggestion may be absent (both fields empty), which makes a 3-sentence
 * message; one empty half is an error.
 */
function validateDailyTalkMessageHouse_(value, fail) {
  var house = value || {};
  var pick = Number(house.pick || 0);
  if (!(pick >= 1 && pick <= RM_DAILY_TALK_GEN.SENTENCE_COUNT)) {
    fail('messageHouse.pick', '고른 문장 번호가 1~' + RM_DAILY_TALK_GEN.SENTENCE_COUNT + '이어야 합니다.');
  }
  ['conclusion', 'reason', 'detail'].forEach(function (key) {
    validateDailyTalkPair_(house[key], 'messageHouse.' + key, fail, true);
  });

  var suggestion = house.suggestion || {};
  var hasEn = !!String(suggestion.en || '').trim();
  var hasKo = !!String(suggestion.ko || '').trim();
  if (hasEn || hasKo) validateDailyTalkPair_(suggestion, 'messageHouse.suggestion', fail, true);
}

/**
 * One {en, ko} sentence. When required, both halves must be there, in the
 * right script and a sensible length.
 */
function validateDailyTalkPair_(pair, prefix, fail, required) {
  var value = pair || {};
  var en = String(value.en || '').trim();
  var ko = String(value.ko || '').trim();
  if (required) {
    if (!en) fail(prefix + '.en', '영어 문장이 비어 있습니다.');
    if (!ko) fail(prefix + '.ko', '한글 문장이 비어 있습니다.');
  }
  if (en && RM_HANGUL_PATTERN.test(en)) fail(prefix + '.en', '영어 문장에 한글이 있습니다.');
  if (en && !RM_LATIN_PATTERN.test(en)) fail(prefix + '.en', '영어 문장에 영어가 없습니다.');
  if (en && en.split(/\s+/).filter(Boolean).length > 24) fail(prefix + '.en', '영어 문장이 너무 깁니다.');
  if (ko && !RM_HANGUL_PATTERN.test(ko)) fail(prefix + '.ko', '한글 문장에 한글이 없습니다.');
}

/**
 * The five steps must talk about the same three sentences: at least two of the
 * words reappear in the English sentences, and the Answer grows out of the
 * sentence it picked.
 */
function validateDailyTalkStepLinks_(value, fail) {
  var content = value || {};
  var sentences = Array.isArray(content.sentences) ? content.sentences : [];
  var words = Array.isArray(content.words) ? content.words : [];
  var english = sentences.map(function (row) { return String((row && row.en) || ''); }).join(' ');
  var used = words.filter(function (word) { return dailyTalkWordAppearsIn_(word && word.en, english); });
  if (words.length >= 2 && used.length < 2) {
    fail('words', '단어가 문장에 쓰이지 않았습니다: ' + words.map(function (word) {
      return String((word && word.en) || '');
    }).join(', '));
  }

  var pick = Number((dailyTalkStructureTypeOf_(content) === 'MESSAGE_HOUSE'
    ? content.messageHouse && content.messageHouse.pick
    : content.aaa && content.aaa.pick));
  var picked = sentences[pick - 1];

  if (dailyTalkStructureTypeOf_(content) === 'MESSAGE_HOUSE') {
    var house = content.messageHouse || {};
    var conclusionEn = String((house.conclusion && house.conclusion.en) || '');
    var messageEn = ['conclusion', 'reason', 'detail', 'suggestion'].map(function (key) {
      return String((house[key] && house[key].en) || '').trim();
    }).filter(Boolean).join(' ');
    // The conclusion names the point; the rest of the message should still be
    // recognisably the sentence the learner picked.
    if (picked && conclusionEn && !dailyTalkSentencesShareWord_(picked.en, messageEn)) {
      fail('messageHouse.conclusion', '고른 문장과 이어지지 않습니다.');
    }
    var houseUsed = words.filter(function (word) { return dailyTalkWordAppearsIn_(word && word.en, messageEn); });
    if (words.length && !houseUsed.length) {
      fail('messageHouse', '1단계 단어가 업무 메시지에 쓰이지 않았습니다: ' + words.map(function (word) {
        return String((word && word.en) || '');
      }).join(', '));
    }
    return;
  }

  var answerEn = String((content.aaa && content.aaa.answer && content.aaa.answer.en) || '');
  if (picked && answerEn && !dailyTalkSentencesShareWord_(picked.en, answerEn)) {
    fail('aaa.answer', '고른 문장과 이어지지 않습니다.');
  }
}

/**
 * STEP 5 of a content object as {type, pick, steps:[{label, en, ko}]}. One
 * shape for both tracks, so STRUCTURE_JSON, MODEL_EN/KO and the CMS body are
 * written the same way; an empty Suggestion is dropped, leaving 3 sentences.
 */
function buildDailyTalkStep5_(content) {
  var value = content || {};
  var type = dailyTalkStructureTypeOf_(value);
  var source = type === 'MESSAGE_HOUSE' ? (value.messageHouse || {}) : (value.aaa || {});
  var steps = dailyTalkStructureSteps(type).map(function (step) {
    var pair = source[step.key] || {};
    return { label: step.label, en: pair.en || '', ko: pair.ko || '' };
  }).filter(function (step) { return String(step.en || '').trim(); });
  return { type: type, pick: Number(source.pick) || 1, steps: steps };
}

/** Step 5 as the plain text kept in MODEL_EN / MODEL_KO (and the CMS model fields). */
function buildStep5ScriptText_(step5, lang) {
  var key = lang === 'ko' ? 'ko' : 'en';
  var steps = (step5 && step5.steps) || [];
  return steps.map(function (step) {
    return step.label + ': ' + String(step[key] || '').trim();
  }).join('\n');
}

/** The practice cue for a structure type (YOUR_TURN_*). */
function dailyTalkPracticeCue_(structureType) {
  return RM_DAILY_TALK_PRACTICE_CUES[structureType === 'MESSAGE_HOUSE' ? 'MESSAGE_HOUSE' : 'AAA'];
}

/** Back-compat wrapper: AAA script text from a bare aaa object. */
function buildAaaScriptText_(aaa, lang) {
  return buildStep5ScriptText_(buildDailyTalkStep5_({ structureType: 'AAA', aaa: aaa }), lang);
}

/** 'How was your weekend?' -> 'how-was-your-weekend' (max 4 words). */
function slugifyTopic(text) {
  return String(text === null || text === undefined ? '' : text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 4)
    .join('-');
}

/** CONTENT_ID = TRACK-YYYYMMDD-slug, made unique against existing ids. */
function buildContentId(track, dateKey, topicEn, existingIds) {
  var normalizedTrack = normalizeTrack(track) === RM_TRACKS.BUSINESS ? RM_TRACKS.BUSINESS : RM_TRACKS.SMALL_TALK;
  var day = String(dateKey || '').replace(/[^0-9]/g, '').slice(0, 8) || '00000000';
  var slug = slugifyTopic(topicEn) || 'daily-talk';
  var base = normalizedTrack + '-' + day + '-' + slug;
  var taken = {};
  (existingIds || []).forEach(function (id) { if (id) taken[String(id).trim()] = true; });
  if (!taken[base]) return base;
  var suffix = 2;
  while (taken[base + '-' + suffix]) suffix += 1;
  return base + '-' + suffix;
}

/** Kakao body teaser stored in 콘텐츠대기열 before the post URL exists. */
function buildKakaoTeaser(content) {
  var value = content || {};
  var title = String(value.topicKo || value.topicEn || '오늘의 영어').trim();
  var lines = ['(광고) 라이언멤버스 Ryan Daily Talk', title, ''];
  if (value.snackKo) lines.push(String(value.snackKo).trim());
  lines.push('');
  lines.push('오늘의 표현과 말하기 미션은 게시물에서 확인하세요.');
  return lines.join('\n');
}

/**
 * Lays a generated item out in the existing 콘텐츠대기열 columns.
 * headerMap: { headerName: 1-based column }. Returns a row array sized to the
 * sheet's widest column, with only the mapped cells filled.
 */
function buildQueueRowValues(headerMap, content, meta) {
  var map = headerMap || {};
  var value = content || {};
  var info = meta || {};
  var width = 0;
  Object.keys(map).forEach(function (header) { width = Math.max(width, Number(map[header]) || 0); });
  var row = new Array(width).fill('');

  function put(header, cellValue) {
    var column = Number(map[header]);
    if (!column) return;
    row[column - 1] = cellValue;
  }

  put('CONTENT_ID', info.contentId || '');
  put('발송일', info.sendDate || '');
  put('트랙', value.track || '');
  put('레벨', value.level || '');
  put('상태', info.status || RM_DAILY_TALK_GEN.STATUS_DRAFT);
  put('TOPIC_EN', value.topicEn || '');
  put('TOPIC_KO', value.topicKo || '');
  put('SNACK_EN', value.snackEn || '');
  put('SNACK_KO', value.snackKo || '');
  put('CHUNKS_JSON', JSON.stringify(value.words || []));
  put('WORD_ORDER_JSON', JSON.stringify(value.sentences || []));
  var step5 = buildDailyTalkStep5_(value);
  put('STRUCTURE_JSON', JSON.stringify({
    type: step5.type,
    pick: step5.pick,
    steps: step5.steps
  }));
  put('SUBSTITUTIONS_JSON', '');
  put('MODEL_EN', buildStep5ScriptText_(step5, 'en'));
  put('MODEL_KO', buildStep5ScriptText_(step5, 'ko'));
  put('YOUR_TURN_EN', dailyTalkPracticeCue_(step5.type).en);
  put('YOUR_TURN_KO', dailyTalkPracticeCue_(step5.type).ko);
  put('SOURCES', info.sources || '');
  put('카카오본문', buildKakaoTeaser(value));
  put('생성시각', info.generatedAt || '');
  put('발송시각', '');
  put('오류', info.error || '');
  return row;
}

/** Which tracks still need content for the given day. */
function findMissingTracks(queueItems, dateKey, tracks) {
  // A verification row (TEST) or a failed attempt does not count as today's content.
  var ignoredStatuses = { TEST: true, FAILED: true };
  var have = {};
  (queueItems || []).forEach(function (item) {
    if (!item) return;
    var itemDate = String(item.dateKey || '').trim();
    if (itemDate !== dateKey) return;
    var status = String(item.status || '').trim().toUpperCase();
    if (ignoredStatuses[status]) return;
    var track = normalizeTrack(item.track);
    if (track) have[track] = true;
  });
  return (tracks || []).filter(function (track) { return !have[normalizeTrack(track)]; });
}

/** Most recent topics of a track, newest first, to keep the model from repeating. */
function recentTopicsForTrack(queueItems, track, limit) {
  var wanted = normalizeTrack(track);
  var max = Number(limit) || RM_DAILY_TALK_GEN.RECENT_TOPIC_LOOKBACK;
  var out = [];
  (queueItems || []).forEach(function (item) {
    if (!item) return;
    if (normalizeTrack(item.track) !== wanted) return;
    var topic = String(item.topicEn || item.topicKo || '').trim();
    if (topic) out.push(topic);
  });
  return out.slice(-max).reverse();
}

/** Model list: configured model first, then the fallbacks without duplicates. */
function resolveModelChain(configured) {
  var chain = [];
  [configured, RM_DAILY_TALK_GEN.DEFAULT_MODEL].concat(RM_DAILY_TALK_GEN.FALLBACK_MODELS).forEach(function (model) {
    var name = String(model === null || model === undefined ? '' : model).trim();
    if (name && chain.indexOf(name) === -1) chain.push(name);
  });
  return chain;
}

/** A generated item is storable when it validates and has an id. */
function isStorableGeneratedItem(item) {
  if (!item) return false;
  if (!item.contentId) return false;
  return validateGeneratedContent(item.content).ok;
}

// ---------------------------------------------------------------------------
// Service layer
// ---------------------------------------------------------------------------

/**
 * Generates today's missing Daily Talk content and appends it to 콘텐츠대기열.
 * options: { dateKey, tracks, level, status, force, dryRun, seed, model, settings, ss }
 */
function generateDailyTalkContent(options) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return { ok: false, errorCode: 'BUSY' };
  try {
    return generateDailyTalkContent_(options);
  } finally {
    lock.releaseLock();
  }
}

/** Called from the daily pipeline when AUTO_GENERATE is on (lock already held). */
function generateDailyTalkContentIfNeeded(options) {
  var opts = options || {};
  var ss = opts.ss || SpreadsheetApp.openById(rmDailyTalkOperationsSpreadsheetId_());
  var settings = opts.settings || loadDailyTalkSettings_(ss);
  if (!isAutoGenerateEnabled_(settings)) return { ok: true, skipped: 'AUTO_GENERATE_OFF', generated: [] };
  return generateDailyTalkContent_(Object.assign({}, opts, { ss: ss, settings: settings }));
}

/**
 * Workhorse. Assumes the script lock is held by the caller.
 * Never sends a Kakao message; only appends queue rows.
 */
function generateDailyTalkContent_(options) {
  var opts = options || {};
  var ss = opts.ss || SpreadsheetApp.openById(rmDailyTalkOperationsSpreadsheetId_());
  var settings = opts.settings || loadDailyTalkSettings_(ss);
  var timezone = String(settings.TIMEZONE || 'Asia/Seoul');
  var dateKey = String(opts.dateKey || formatDateKey_(new Date(), timezone, 'yyyy-MM-dd'));
  var level = String(opts.level || settings.DEFAULT_LEVEL || RM_DAILY_TALK_GEN.DEFAULT_LEVEL).trim().toUpperCase();
  var requestedTracks = parseTrackList(opts.tracks || settings.TRACKS_TO_GENERATE);
  var status = String(opts.status || (toBoolean(settings.AUTO_APPROVE) ? RM_DAILY_TALK_GEN.STATUS_APPROVED : RM_DAILY_TALK_GEN.STATUS_DRAFT)).toUpperCase();
  var dryRun = toBoolean(opts.dryRun);

  var sheet = getDailyTalkSheet_(ss, RM_DAILY_TALK_CONFIG.QUEUE_SHEET);
  ensureQueueHeaderColumns_(sheet);
  var headerMap = queueHeaderMap_(sheet);
  var items = readQueueRows_(sheet).map(function (item) {
    return Object.assign({}, item, { dateKey: formatDateKey_(item.sendDate, timezone, 'yyyy-MM-dd') });
  });
  var existingIds = items.map(function (item) { return item.contentId; });
  var pendingTracks = toBoolean(opts.force) ? requestedTracks : findMissingTracks(items, dateKey, requestedTracks);

  var generated = [];
  var failures = [];
  var modelChain = resolveModelChain(opts.model || settings.OPENAI_MODEL);

  pendingTracks.forEach(function (track) {
    try {
      var prompt = buildContentPrompt(track, {
        date: dateKey,
        level: level,
        recentTopics: recentTopicsForTrack(items, track),
        seed: opts.seed
      });
      var attempt = callOpenAiForContent_(prompt, modelChain);
      var content = normalizeGeneratedContent(parseGeneratedContent(extractOpenAiText(attempt.payload)), {
        track: track,
        level: level
      });
      var validation = validateGeneratedContent(content);
      if (!validation.ok) {
        throw new Error('생성 결과 검증 실패: ' + validation.errors.map(function (error) {
          return error.field + ' (' + error.message + ')';
        }).slice(0, 4).join(', '));
      }

      var contentId = buildContentId(track, dateKey.replace(/-/g, ''), content.topicEn, existingIds);
      var item = {
        contentId: contentId,
        content: content,
        model: attempt.model,
        status: status,
        sendDate: dateKey,
        track: track
      };

      if (!dryRun) {
        var rowNumber = sheet.getLastRow() + 1;
        var values = buildQueueRowValues(headerMap, content, {
          contentId: contentId,
          sendDate: dateKey,
          status: status,
          sources: RM_DAILY_TALK_GEN.SOURCE_PREFIX + attempt.model,
          generatedAt: new Date()
        });
        sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
        item.rowNumber = rowNumber;
        items.push({
          contentId: contentId,
          track: track,
          topicEn: content.topicEn,
          topicKo: content.topicKo,
          dateKey: dateKey
        });
        existingIds.push(contentId);
      }
      generated.push(item);
    } catch (error) {
      failures.push({
        track: track,
        message: String(error && error.message ? error.message : error)
      });
    }
  });

  return {
    ok: failures.length === 0,
    dateKey: dateKey,
    level: level,
    status: status,
    dryRun: dryRun,
    requestedTracks: requestedTracks,
    generated: generated,
    failures: failures
  };
}

/** One Responses API call with per-model retries, falling back across models. */
function callOpenAiForContent_(prompt, modelChain) {
  var key = getScriptProperty_('OPENAI_API_KEY');
  if (!key) throw new Error('Script Properties에 OPENAI_API_KEY가 없습니다.');

  var models = modelChain && modelChain.length ? modelChain : resolveModelChain('');
  var lastError = null;

  for (var m = 0; m < models.length; m += 1) {
    var model = models[m];
    for (var attempt = 1; attempt <= RM_DAILY_TALK_GEN.ATTEMPTS_PER_MODEL; attempt += 1) {
      var response = UrlFetchApp.fetch(RM_DAILY_TALK_GEN.OPENAI_RESPONSES_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + key },
        payload: JSON.stringify({
          model: model,
          reasoning: { effort: RM_DAILY_TALK_GEN.REASONING_EFFORT },
          max_output_tokens: RM_DAILY_TALK_GEN.MAX_OUTPUT_TOKENS,
          text: {
            format: {
              type: 'json_schema',
              name: prompt.schemaName,
              strict: true,
              schema: prompt.schema
            }
          },
          input: [
            { role: 'system', content: [{ type: 'input_text', text: prompt.system }] },
            { role: 'user', content: [{ type: 'input_text', text: prompt.user }] }
          ]
        }),
        muteHttpExceptions: true
      });

      var code = response.getResponseCode();
      var body = response.getContentText();
      if (code >= 200 && code < 300) {
        var payload = safeJsonParse(body, null);
        if (!payload) throw new Error('OpenAI 응답을 해석할 수 없습니다.');
        if (payload.status === 'incomplete') {
          var reason = payload.incomplete_details && payload.incomplete_details.reason ? payload.incomplete_details.reason : 'incomplete';
          throw new Error('OpenAI 응답이 완료되지 않았습니다: ' + reason);
        }
        return { model: model, payload: payload, attempts: attempt };
      }

      lastError = new Error('OpenAI 호출 실패 (' + code + ', ' + model + '): ' + String(body).slice(0, 400));
      if (isRetryableOpenAiStatus_(code) && attempt < RM_DAILY_TALK_GEN.ATTEMPTS_PER_MODEL) {
        Utilities.sleep(RM_DAILY_TALK_GEN.RETRY_DELAY_MS * attempt);
        continue;
      }
      break; // next model
    }
  }
  throw lastError || new Error('OpenAI 호출에 실패했습니다.');
}

function isRetryableOpenAiStatus_(code) {
  return code === 429 || code === 500 || code === 502 || code === 503 || code === 504;
}

/** Adds the publication + lesson columns the pipeline writes when a sheet lacks them. */
function ensureQueueHeaderColumns_(sheet) {
  var headerRow = RM_DAILY_TALK_GEN.QUEUE_HEADER_ROW;
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(headerRow, 1, 1, lastColumn).getDisplayValues()[0].map(function (header) {
    return String(header).trim();
  });
  var wanted = RM_DAILY_TALK_GEN.PUBLISH_HEADERS.concat(RM_DAILY_TALK_GEN.STEP_HEADERS);
  var missing = wanted.filter(function (header) {
    return headers.indexOf(header) === -1;
  });
  if (!missing.length) return headers;
  if (sheet.getMaxColumns() < headers.length + missing.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length + missing.length - sheet.getMaxColumns());
  }
  sheet.getRange(headerRow, headers.length + 1, 1, missing.length).setValues([missing]);
  return headers.concat(missing);
}

function isAutoGenerateEnabled_(settings) {
  var raw = settings && settings.AUTO_GENERATE !== undefined ? settings.AUTO_GENERATE : false;
  return toBoolean(raw);
}

/** Sheet date cells arrive as Date, text or number; normalise to a day key. */
function formatDateKey_(value, timezone, pattern) {
  if (!value) return '';
  if (value instanceof Date) {
    return Utilities.formatDate(value, timezone || 'Asia/Seoul', pattern || 'yyyy-MM-dd');
  }
  var text = String(value).trim();
  var matched = text.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})/);
  if (matched) {
    return pattern === 'yyyyMMdd' ? matched[1] + matched[2] + matched[3] : matched[1] + '-' + matched[2] + '-' + matched[3];
  }
  return text;
}

/** Menu entry: generate whatever today's queue is still missing. */
function generateTodayDailyTalkContent() {
  var result = generateDailyTalkContent({});
  Logger.log(JSON.stringify({
    ok: result.ok,
    dateKey: result.dateKey,
    status: result.status,
    generated: (result.generated || []).map(function (item) {
      return { contentId: item.contentId, track: item.track, model: item.model, rowNumber: item.rowNumber };
    }),
    failures: result.failures
  }));
  return result;
}

/** Owner diagnostic: which OpenAI models this key can use (no secret leaves). */
function listOpenAiModels() {
  var key = getScriptProperty_('OPENAI_API_KEY');
  if (!key) return { ok: false, error: 'OPENAI_API_KEY가 없습니다.' };
  var response = UrlFetchApp.fetch(RM_DAILY_TALK_GEN.OPENAI_MODELS_URL, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + key },
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code < 200 || code >= 300) {
    return { ok: false, status: code, error: String(body).slice(0, 300) };
  }
  var parsed = safeJsonParse(body, {});
  var ids = (parsed.data || []).map(function (model) { return model.id; }).sort();
  return { ok: true, count: ids.length, models: ids };
}

/** Non-secret status of the generator, for the owner menu and reports. */
function checkDailyTalkGeneratorSetup() {
  var ss = SpreadsheetApp.openById(rmDailyTalkOperationsSpreadsheetId_());
  var settings = loadDailyTalkSettings_(ss);
  return {
    ok: true,
    hasOpenAiKey: !!getScriptProperty_('OPENAI_API_KEY'),
    model: String(settings.OPENAI_MODEL || RM_DAILY_TALK_GEN.DEFAULT_MODEL),
    fallbacks: resolveModelChain(settings.OPENAI_MODEL),
    tracks: parseTrackList(settings.TRACKS_TO_GENERATE),
    level: String(settings.DEFAULT_LEVEL || RM_DAILY_TALK_GEN.DEFAULT_LEVEL),
    // STEP 5 differs by track: small talk AAA, business Message House.
    structures: parseTrackList(settings.TRACKS_TO_GENERATE).reduce(function (map, track) {
      map[track] = dailyTalkStructureTypeFor(track);
      return map;
    }, {}),
    autoGenerate: isAutoGenerateEnabled_(settings),
    autoApprove: toBoolean(settings.AUTO_APPROVE),
    statusOnCreate: toBoolean(settings.AUTO_APPROVE) ? RM_DAILY_TALK_GEN.STATUS_APPROVED : RM_DAILY_TALK_GEN.STATUS_DRAFT,
    testMode: isTestMode_(settings)
  };
}
