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
  CONTENT_FIELDS: ['topicEn', 'topicKo', 'snackEn', 'snackKo', 'modelEn', 'modelKo', 'yourTurnEn', 'yourTurnKo']
});

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

/** JSON schema for one Daily Talk item (Responses API structured output). */
function buildDailyTalkContentSchema() {
  var chunkSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['en', 'ko'],
    properties: {
      en: { type: 'string' },
      ko: { type: 'string' }
    }
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: RM_DAILY_TALK_GEN.CONTENT_FIELDS.concat(['chunks']),
    properties: {
      topicEn: { type: 'string' },
      topicKo: { type: 'string' },
      snackEn: { type: 'string' },
      snackKo: { type: 'string' },
      chunks: { type: 'array', minItems: 3, maxItems: 4, items: chunkSchema },
      modelEn: { type: 'string' },
      modelKo: { type: 'string' },
      yourTurnEn: { type: 'string' },
      yourTurnKo: { type: 'string' }
    }
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

  var system = [
    'You write Ryan Daily Talk, the weekday English-learning message sent to Korean adult learners on KakaoTalk by',
    'Ryan Members, an English conversation academy in Busan. Brand line: "English Opens a New World."',
    'The reader is a busy Korean adult at ' + level + ' level (CEFR A2-B1): they understand everyday English but',
    'freeze when they have to speak. Write warm, practical, natural English they can actually say today.',
    'Never use markdown, emoji, hashtags, or quotation marks around whole fields. Return JSON only.'
  ].join(' ');

  var lines = [
    'Track: ' + brief,
    'Learner level: ' + level,
    (opts.date ? 'Send date: ' + opts.date : ''),
    (seed ? 'Topic seed (use it or a close variation): ' + seed : ''),
    recent.length ? 'Do NOT reuse these recent topics: ' + recent.join(' | ') : '',
    '',
    'Write one item with these fields (all in the JSON schema):',
    '- topicEn: a short catchy English title, 2-6 words, no ending period.',
    '- topicKo: the same title in natural Korean (no English parentheses).',
    '- snackEn: 2-3 sentences (max 45 words) that introduce one key expression in a real situation.',
    '- snackKo: a faithful, natural Korean translation of snackEn.',
    '- chunks: 3-4 expressions Korean learners can drop straight into conversation. Each has "en" (max 12 words) and "ko" (natural Korean). Mix one opener, one response and one follow-up where it fits.',
    '- modelEn: a 3-4 line mini dialogue using the chunks, each line starting with "A: " or "B: ".',
    '- modelKo: the Korean translation of modelEn, same A/B line breaks.',
    '- yourTurnEn: one speaking mission for today, max 25 words, starting with a verb (Try, Ask, Tell, Practice...).',
    '- yourTurnKo: the Korean translation of yourTurnEn.',
    '',
    'Hard rules:',
    '- Write spoken English: use contractions (I\'m, it\'s, we\'ll, don\'t) and avoid textbook stiffness.',
    '- English fields contain English only (no Hangul). Korean fields contain Korean (Hangul) only.',
    '- Keep every expression polite and safe for a workplace and a family chat.',
    '- No brand names, no prices, no politics, no religion, no medical or legal advice.',
    '- The topic must be different from the recent topics above and useful this week.'
  ].filter(function (line, index, all) { return line !== '' || all[index - 1] !== ''; });

  return {
    track: normalizedTrack,
    level: level,
    schemaName: 'ryan_daily_talk_' + normalizedTrack.toLowerCase(),
    schema: buildDailyTalkContentSchema(),
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
  var chunks = Array.isArray(raw.chunks) ? raw.chunks : [];
  return {
    track: normalizeTrack(ctx.track) === RM_TRACKS.BUSINESS ? RM_TRACKS.BUSINESS : RM_TRACKS.SMALL_TALK,
    level: String(ctx.level || RM_DAILY_TALK_GEN.DEFAULT_LEVEL).trim().toUpperCase(),
    topicEn: cleanText_(raw.topicEn),
    topicKo: cleanText_(raw.topicKo),
    snackEn: cleanText_(raw.snackEn),
    snackKo: cleanText_(raw.snackKo),
    chunks: chunks.map(function (chunk) {
      if (typeof chunk === 'string') return { en: cleanText_(chunk), ko: '' };
      return { en: cleanText_(chunk && chunk.en), ko: cleanText_(chunk && chunk.ko) };
    }),
    modelEn: cleanText_(raw.modelEn, { keepLines: true }),
    modelKo: cleanText_(raw.modelKo, { keepLines: true }),
    yourTurnEn: cleanText_(raw.yourTurnEn),
    yourTurnKo: cleanText_(raw.yourTurnKo)
  };
}

var RM_HANGUL_PATTERN = /[\uAC00-\uD7A3]/;
var RM_LATIN_PATTERN = /[A-Za-z]/;

/** Field-level validation; returns {ok, errors:[{field, message}]}. */
function validateGeneratedContent(content) {
  var value = content || {};
  var errors = [];
  function fail(field, message) { errors.push({ field: field, message: message }); }

  RM_DAILY_TALK_GEN.CONTENT_FIELDS.forEach(function (field) {
    if (!String(value[field] || '').trim()) fail(field, '비어 있습니다.');
  });

  ['topicEn', 'snackEn', 'modelEn', 'yourTurnEn'].forEach(function (field) {
    var text = String(value[field] || '');
    if (text && RM_HANGUL_PATTERN.test(text)) fail(field, '영어 필드에 한글이 있습니다.');
    if (text && !RM_LATIN_PATTERN.test(text)) fail(field, '영어 필드에 영어가 없습니다.');
  });

  ['topicKo', 'snackKo', 'modelKo', 'yourTurnKo'].forEach(function (field) {
    var text = String(value[field] || '');
    if (text && !RM_HANGUL_PATTERN.test(text)) fail(field, '한글 필드에 한글이 없습니다.');
  });

  if (String(value.topicEn || '').length > 70) fail('topicEn', '제목이 너무 깁니다.');
  if (String(value.topicKo || '').length > 60) fail('topicKo', '제목이 너무 깁니다.');
  if (String(value.snackEn || '').split(/\s+/).filter(Boolean).length > 70) fail('snackEn', '스낵 설명이 너무 깁니다.');
  if (String(value.yourTurnEn || '').split(/\s+/).filter(Boolean).length > 40) fail('yourTurnEn', '미션이 너무 깁니다.');
  if (String(value.modelEn || '').indexOf('A:') === -1 || String(value.modelEn || '').indexOf('B:') === -1) {
    fail('modelEn', 'A:/B: 대화 형식이 아닙니다.');
  }

  var chunks = Array.isArray(value.chunks) ? value.chunks : [];
  if (chunks.length < 3 || chunks.length > 4) fail('chunks', '청크는 3~4개여야 합니다.');
  chunks.forEach(function (chunk, index) {
    var en = String((chunk && chunk.en) || '');
    var ko = String((chunk && chunk.ko) || '');
    if (!en.trim()) fail('chunks[' + index + '].en', '영어 표현이 비어 있습니다.');
    if (!ko.trim()) fail('chunks[' + index + '].ko', '한글 뜻이 비어 있습니다.');
    if (RM_HANGUL_PATTERN.test(en)) fail('chunks[' + index + '].en', '영어 표현에 한글이 있습니다.');
    if (ko && !RM_HANGUL_PATTERN.test(ko)) fail('chunks[' + index + '].ko', '한글 뜻에 한글이 없습니다.');
  });

  return { ok: errors.length === 0, errors: errors };
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
  put('CHUNKS_JSON', JSON.stringify(value.chunks || []));
  put('MODEL_EN', value.modelEn || '');
  put('MODEL_KO', value.modelKo || '');
  put('YOUR_TURN_EN', value.yourTurnEn || '');
  put('YOUR_TURN_KO', value.yourTurnKo || '');
  put('SOURCES', info.sources || '');
  put('카카오본문', buildKakaoTeaser(value));
  put('생성시각', info.generatedAt || '');
  put('발송시각', '');
  put('오류', info.error || '');
  return row;
}

/** Which tracks still need content for the given day. */
function findMissingTracks(queueItems, dateKey, tracks) {
  var have = {};
  (queueItems || []).forEach(function (item) {
    if (!item) return;
    var itemDate = String(item.dateKey || '').trim();
    if (itemDate !== dateKey) return;
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

/** Adds the publication columns the pipeline writes when a sheet lacks them. */
function ensureQueueHeaderColumns_(sheet) {
  var headerRow = RM_DAILY_TALK_GEN.QUEUE_HEADER_ROW;
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(headerRow, 1, 1, lastColumn).getDisplayValues()[0].map(function (header) {
    return String(header).trim();
  });
  var missing = RM_DAILY_TALK_GEN.PUBLISH_HEADERS.filter(function (header) {
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
    autoGenerate: isAutoGenerateEnabled_(settings),
    autoApprove: toBoolean(settings.AUTO_APPROVE),
    statusOnCreate: toBoolean(settings.AUTO_APPROVE) ? RM_DAILY_TALK_GEN.STATUS_APPROVED : RM_DAILY_TALK_GEN.STATUS_DRAFT,
    testMode: isTestMode_(settings)
  };
}
