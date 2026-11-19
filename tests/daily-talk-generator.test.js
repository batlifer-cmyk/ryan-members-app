/**
 * Daily Talk content generator — pure-layer tests.
 * The generator is exercised through the exact .gs source that goes to Apps
 * Script; no network, Sheets or OpenAI call is made here.
 *
 * The lesson is the academy's five steps:
 *   1 words (3) -> 2 Korean sentences (3) -> 3 the same sentences in English
 *   word order -> 4 the same sentences in English -> 5 AAA on one of them.
 */
const fs = require('fs');
const path = require('path');

const BUSINESS_SAMPLE = {
  topicEn: 'One More Day',
  topicKo: '하루 더 필요한 상황',
  snackEn: 'The final check found two bugs. Today you tell your team the launch needs one more day.',
  snackKo: '마지막 점검에서 오류 두 개가 나왔습니다. 오늘은 팀에 출시가 하루 더 필요하다고 말합니다.',
  words: [
    { en: 'one more day', ko: '하루 더' },
    { en: 'push the launch', ko: '출시를 미루다' },
    { en: 'keep you posted', ko: '계속 알려 주다' }
  ],
  sentences: [
    {
      ko: '우리는 출시에 하루가 더 필요합니다',
      order: [
        { role: '누가', text: '우리는' },
        { role: '한다', text: '필요합니다' },
        { role: '무엇을', text: '하루가 더' },
        { role: '어디서', text: '출시에' }
      ],
      en: 'We need one more day for the launch.'
    },
    {
      ko: '저는 출시를 금요일로 미룹니다',
      order: [
        { role: '누가', text: '저는' },
        { role: '한다', text: '미룹니다' },
        { role: '무엇을', text: '출시를' },
        { role: '언제', text: '금요일로' }
      ],
      en: 'I will push the launch to Friday.'
    },
    {
      ko: '제가 계속 상황을 알려 드리겠습니다',
      order: [
        { role: '누가', text: '제가' },
        { role: '한다', text: '알려 드리겠습니다' },
        { role: '무엇을', text: '상황을' },
        { role: '어떻게', text: '계속' }
      ],
      en: 'I will keep you posted.'
    }
  ],
  aaa: {
    pick: 1,
    answer: { en: 'We need one more day for the launch.', ko: '출시에 하루가 더 필요합니다.' },
    add: { en: 'The final check found two bugs.', ko: '마지막 점검에서 오류 두 개가 나왔습니다.' },
    ask: { en: 'Does Friday still work for you?', ko: '금요일도 괜찮으실까요?' }
  }
};

const SAMPLE = {
  topicEn: 'Warm Coffee Morning',
  topicKo: '따뜻한 커피 아침',
  snackEn: 'You walk to work on a cold morning and stop for a coffee. Today you say what you drink on the way.',
  snackKo: '추운 아침에 걸어서 출근하다가 커피를 사요. 오늘은 출근길에 무엇을 마시는지 말해 봅니다.',
  words: [
    { en: 'warm coffee', ko: '따뜻한 커피' },
    { en: 'on my way to work', ko: '출근길에' },
    { en: 'grab', ko: '(음료를) 사서 들다' }
  ],
  sentences: [
    {
      ko: '나는 오늘 아침 출근길에 따뜻한 커피를 마셨다',
      order: [
        { role: '누가', text: '나는' },
        { role: '한다', text: '마셨다' },
        { role: '무엇을', text: '따뜻한 커피를' },
        { role: '어디서', text: '출근길에' },
        { role: '언제', text: '오늘 아침' }
      ],
      en: 'I had a warm coffee on my way to work this morning.'
    },
    {
      ko: '나는 출근길에 커피를 사서 들었다',
      order: [
        { role: '누가', text: '나는' },
        { role: '한다', text: '사서 들었다' },
        { role: '무엇을', text: '커피를' },
        { role: '어디서', text: '출근길에' }
      ],
      en: 'I grabbed a coffee on my way to work.'
    },
    {
      ko: '나는 아침에 따뜻한 커피가 필요하다',
      order: [
        { role: '누가', text: '나는' },
        { role: '한다', text: '필요하다' },
        { role: '무엇을', text: '따뜻한 커피가' },
        { role: '언제', text: '아침에' }
      ],
      en: 'I need a warm coffee in the morning.'
    }
  ],
  aaa: {
    pick: 1,
    answer: { en: 'Yeah, I had a warm coffee on my way to work.', ko: '네, 출근길에 따뜻한 커피를 마셨어요.' },
    add: { en: 'It was freezing outside.', ko: '밖이 정말 추웠거든요.' },
    ask: { en: 'How about you?', ko: '당신은요?' }
  }
};

describe('parseTrackList', () => {
  test('reads the 설정 sheet value in order', () => {
    assert.deepEqual(parseTrackList('SMALL_TALK,BUSINESS'), ['SMALL_TALK', 'BUSINESS']);
  });

  test('accepts spaces, mixed case and a single track', () => {
    assert.deepEqual(parseTrackList(' business , small talk '), ['BUSINESS', 'SMALL_TALK']);
    assert.deepEqual(parseTrackList('SMALL_TALK'), ['SMALL_TALK']);
  });

  test('expands BOTH and de-duplicates', () => {
    assert.deepEqual(parseTrackList('BOTH'), ['SMALL_TALK', 'BUSINESS']);
    assert.deepEqual(parseTrackList('SMALL_TALK,SMALL_TALK'), ['SMALL_TALK']);
  });

  test('falls back to both tracks for an empty or unknown value', () => {
    assert.deepEqual(parseTrackList(''), ['SMALL_TALK', 'BUSINESS']);
    assert.deepEqual(parseTrackList('marketing'), ['SMALL_TALK', 'BUSINESS']);
  });
});

describe('buildContentPrompt', () => {
  test('describes the requested track and level', () => {
    const business = buildContentPrompt('BUSINESS', { date: '2026-11-20', level: 'BASIC' });
    assert.equal(business.track, 'BUSINESS');
    assert.equal(business.level, 'BASIC');
    assert.includes(business.system, 'Ryan Members');
    assert.includes(business.user, 'workplace English');
    assert.includes(business.user, '2026-11-20');
    assert.equal(business.schemaName, 'ryan_daily_talk_business');
  });

  test('lists recent topics so the model does not repeat them', () => {
    const prompt = buildContentPrompt('SMALL_TALK', { recentTopics: ['Ordering coffee', 'Weekend plans'] });
    assert.includes(prompt.user, 'Ordering coffee');
    assert.includes(prompt.user, 'Weekend plans');
    assert.includes(prompt.user, 'Do NOT reuse');
  });

  test('an unknown track is treated as small talk', () => {
    assert.equal(buildContentPrompt('MARKETING', {}).track, 'SMALL_TALK');
  });

  test('asks for every field of the five steps in plain language', () => {
    const prompt = buildContentPrompt('SMALL_TALK', { level: 'BASIC' });
    ['topicEn', 'topicKo', 'snackEn', 'snackKo', 'words', 'sentences', 'aaa', 'pick', 'answer', 'add', 'ask']
      .forEach((field) => assert.includes(prompt.user, field));
    ['누가', '한다', '무엇을', '어디서', '언제'].forEach((role) => assert.includes(prompt.user, role));
  });

  test('teaches the five steps in order', () => {
    const system = buildContentPrompt('SMALL_TALK', { level: 'BASIC' }).system;
    ['Step 1 Key words', 'Step 2 Korean sentences', 'Step 3 English word order', 'Step 4 English sentences', 'Step 5 AAA']
      .forEach((label) => assert.includes(system, label));
    assert.ok(system.indexOf('Step 1') < system.indexOf('Step 2'));
    assert.ok(system.indexOf('Step 2') < system.indexOf('Step 3'));
    assert.ok(system.indexOf('Step 3') < system.indexOf('Step 4'));
    assert.ok(system.indexOf('Step 4') < system.indexOf('Step 5'));
  });

  test('both tracks use the same five steps, and step 5 is business talk for BUSINESS', () => {
    const small = buildContentPrompt('SMALL_TALK', {});
    assert.equal(small.structureType, 'AAA');
    assert.includes(small.system, 'This card is SMALL TALK');

    const business = buildContentPrompt('BUSINESS', {});
    assert.equal(business.structureType, 'AAA');
    assert.includes(business.system, 'This card is BUSINESS TALK');
    assert.includes(business.system, 'Step 5 AAA');
  });

  test('asks for the steps to point at the same three sentences', () => {
    const prompt = buildContentPrompt('SMALL_TALK', {});
    assert.includes(prompt.system, 'must all point at the same three sentences');
    assert.includes(prompt.user, 'At least two of the three words must visibly appear');
    assert.includes(prompt.user, 'The answer must be built on the picked sentence');
  });
});

describe('buildDailyTalkContentSchema', () => {
  test('is strict and requires exactly the five-step fields', () => {
    const schema = buildDailyTalkContentSchema();
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ['topicEn', 'topicKo', 'snackEn', 'snackKo', 'words', 'sentences', 'aaa']);
    assert.equal(schema.properties.words.minItems, 3);
    assert.equal(schema.properties.words.maxItems, 3);
    assert.deepEqual(schema.properties.words.items.required, ['en', 'ko']);
    assert.equal(schema.properties.sentences.minItems, 3);
    assert.equal(schema.properties.sentences.maxItems, 3);
    assert.deepEqual(schema.properties.sentences.items.required, ['ko', 'order', 'en']);
    assert.deepEqual(schema.properties.sentences.items.properties.order.items.properties.role.enum,
      ['누가', '한다', '무엇을', '어디서', '언제', '어떻게']);
    assert.deepEqual(schema.properties.aaa.required, ['pick', 'answer', 'add', 'ask']);
    assert.equal(schema.properties.aaa.properties.pick.maximum, 3);
  });

  test('the word-order pieces carry a role and the Korean text only', () => {
    const schema = buildDailyTalkContentSchema();
    const piece = schema.properties.sentences.items.properties.order.items;
    assert.deepEqual(piece.required, ['role', 'text']);
    assert.equal(piece.additionalProperties, false);
  });
});

describe('extractOpenAiText', () => {
  test('reads the output_text convenience field', () => {
    assert.equal(extractOpenAiText({ output_text: '{"a":1}' }), '{"a":1}');
  });

  test('walks Responses API message items', () => {
    const payload = {
      output: [
        { type: 'reasoning', content: [] },
        { type: 'message', content: [{ type: 'output_text', text: '{"topicEn":' }, { type: 'output_text', text: '"Hi"}' }] }
      ]
    };
    assert.equal(extractOpenAiText(payload), '{"topicEn":"Hi"}');
  });

  test('falls back to Chat Completions shape', () => {
    assert.equal(extractOpenAiText({ choices: [{ message: { content: '{"ok":true}' } }] }), '{"ok":true}');
  });

  test('returns an empty string for an empty body', () => {
    assert.equal(extractOpenAiText(null), '');
    assert.equal(extractOpenAiText({ output: [] }), '');
  });
});

describe('parseGeneratedContent', () => {
  test('parses clean JSON', () => {
    assert.equal(parseGeneratedContent(JSON.stringify(SAMPLE)).topicEn, SAMPLE.topicEn);
  });

  test('tolerates a fenced code block', () => {
    const text = '```json\n' + JSON.stringify(SAMPLE) + '\n```';
    assert.equal(parseGeneratedContent(text).topicKo, SAMPLE.topicKo);
  });

  test('tolerates leading prose around the object', () => {
    const text = 'Here is today\'s item:\n' + JSON.stringify(SAMPLE) + '\nEnjoy!';
    assert.equal(parseGeneratedContent(text).topicEn, SAMPLE.topicEn);
  });

  test('returns null when there is no JSON', () => {
    assert.equal(parseGeneratedContent('sorry, I cannot help'), null);
    assert.equal(parseGeneratedContent(''), null);
  });
});

describe('normalizeGeneratedContent', () => {
  test('trims quotes, collapses single-line fields and keeps the three steps aligned', () => {
    const content = normalizeGeneratedContent({
      topicEn: '  "Warm Coffee Morning"  ',
      topicKo: '따뜻한   커피  아침',
      snackEn: 'Line one.\nLine two.',
      snackKo: '한 줄.\n두 줄.',
      words: ['warm coffee', { en: 'grab', ko: '사서 들다' }],
      sentences: SAMPLE.sentences,
      aaa: SAMPLE.aaa
    }, { track: 'BUSINESS', level: 'basic' });

    assert.equal(content.track, 'BUSINESS');
    assert.equal(content.level, 'BASIC');
    assert.equal(content.topicEn, 'Warm Coffee Morning');
    assert.equal(content.snackEn, 'Line one. Line two.');
    assert.equal(content.topicKo, '따뜻한 커피 아침');
    assert.deepEqual(content.words[0], { en: 'warm coffee', ko: '' });
    assert.deepEqual(content.words[1], { en: 'grab', ko: '사서 들다' });
    assert.equal(content.sentences[0].order.length, 5);
    assert.deepEqual(content.sentences[0].order[0], { role: '누가', text: '나는' });
    assert.equal(content.aaa.pick, 1);
    assert.equal(content.aaa.ask.en, 'How about you?');
  });

  test('reads the step 3 pieces out of a "누가: 나는 / 한다: 마셨다" string', () => {
    const content = normalizeGeneratedContent({
      sentences: [{
        ko: '나는 커피를 마셨다',
        order: '누가: 나는 / 한다: 마셨다 / 무엇을: 커피를',
        en: 'I had a coffee.'
      }],
      aaa: SAMPLE.aaa
    }, {});
    assert.deepEqual(content.sentences[0].order, [
      { role: '누가', text: '나는' },
      { role: '한다', text: '마셨다' },
      { role: '무엇을', text: '커피를' }
    ]);
  });
});

describe('validateGeneratedContent', () => {
  test('accepts a complete five-step item', () => {
    const result = validateGeneratedContent(normalizeGeneratedContent(SAMPLE, { track: 'SMALL_TALK', level: 'BASIC' }));
    assert.deepEqual(result, { ok: true, errors: [] });
  });

  test('accepts the business track with the same five steps', () => {
    const result = validateGeneratedContent(normalizeGeneratedContent(BUSINESS_SAMPLE, { track: 'BUSINESS' }));
    assert.deepEqual(result, { ok: true, errors: [] });
  });

  test('rejects Hangul inside an English field', () => {
    const content = normalizeGeneratedContent(Object.assign({}, SAMPLE, { topicEn: '주말 인사' }), {});
    const result = validateGeneratedContent(content);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.field === 'topicEn'));
  });

  test('rejects an English-only Korean field', () => {
    const content = normalizeGeneratedContent(Object.assign({}, SAMPLE, { topicKo: 'Weekend talk' }), {});
    const result = validateGeneratedContent(content);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.field === 'topicKo'));
  });

  test('rejects a missing or oversized word list', () => {
    const two = normalizeGeneratedContent(Object.assign({}, SAMPLE, { words: SAMPLE.words.slice(0, 2) }), {});
    assert.ok(validateGeneratedContent(two).errors.some((error) => error.field === 'words'));

    const four = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      words: SAMPLE.words.concat([{ en: 'cold', ko: '추운' }])
    }), {});
    assert.ok(validateGeneratedContent(four).errors.some((error) => error.field === 'words'));
  });

  test('rejects a Korean-only word or an English-only meaning', () => {
    const hangulWord = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      words: [{ en: '커피', ko: '커피' }].concat(SAMPLE.words.slice(1))
    }), {});
    assert.ok(validateGeneratedContent(hangulWord).errors.some((error) => error.field === 'words[0].en'));

    const englishMeaning = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      words: [{ en: 'warm coffee', ko: 'warm coffee' }].concat(SAMPLE.words.slice(1))
    }), {});
    assert.ok(validateGeneratedContent(englishMeaning).errors.some((error) => error.field === 'words[0].ko'));
  });

  test('requires exactly three sentences, each Korean -> order -> English', () => {
    const two = normalizeGeneratedContent(Object.assign({}, SAMPLE, { sentences: SAMPLE.sentences.slice(0, 2) }), {});
    assert.ok(validateGeneratedContent(two).errors.some((error) => error.field === 'sentences'));

    const noKorean = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      sentences: [Object.assign({}, SAMPLE.sentences[0], { ko: 'I had a coffee.' })].concat(SAMPLE.sentences.slice(1))
    }), {});
    assert.ok(validateGeneratedContent(noKorean).errors.some((error) => error.field === 'sentences[0].ko'));

    const koreanEnglish = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      sentences: [Object.assign({}, SAMPLE.sentences[0], { en: '나는 커피를 마셨다' })].concat(SAMPLE.sentences.slice(1))
    }), {});
    assert.ok(validateGeneratedContent(koreanEnglish).errors.some((error) => error.field === 'sentences[0].en'));
  });

  test('rejects word-order pieces that are not role-labelled Korean', () => {
    const englishPiece = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      sentences: [Object.assign({}, SAMPLE.sentences[0], {
        order: [{ role: '누가', text: 'I' }, { role: '한다', text: '마셨다' }]
      })].concat(SAMPLE.sentences.slice(1))
    }), {});
    assert.ok(validateGeneratedContent(englishPiece).errors.some((error) => error.field === 'sentences[0].order[0].text'));

    const unknownRole = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      sentences: [Object.assign({}, SAMPLE.sentences[0], {
        order: [{ role: '누가', text: '나는' }, { role: '동사', text: '마셨다' }]
      })].concat(SAMPLE.sentences.slice(1))
    }), {});
    assert.ok(validateGeneratedContent(unknownRole).errors.some((error) => error.field === 'sentences[0].order[1].role'));
  });

  test('rejects word order that puts 한다 before 누가', () => {
    const swapped = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      sentences: [Object.assign({}, SAMPLE.sentences[0], {
        order: [{ role: '한다', text: '마셨다' }, { role: '누가', text: '나는' }]
      })].concat(SAMPLE.sentences.slice(1))
    }), {});
    assert.ok(validateGeneratedContent(swapped).errors.some((error) => error.field === 'sentences[0].order'));
  });

  test('requires the AAA script to be exactly Answer / Add / Ask', () => {
    const missingAsk = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      aaa: Object.assign({}, SAMPLE.aaa, { ask: { en: '', ko: '' } })
    }), {});
    assert.ok(validateGeneratedContent(missingAsk).errors.some((error) => error.field === 'aaa.ask.en'));

    const badPick = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      aaa: Object.assign({}, SAMPLE.aaa, { pick: 4 })
    }), {});
    assert.ok(validateGeneratedContent(badPick).errors.some((error) => error.field === 'aaa.pick'));

    const englishKorean = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      aaa: Object.assign({}, SAMPLE.aaa, { add: { en: 'It was cold.', ko: 'It was cold.' } })
    }), {});
    assert.ok(validateGeneratedContent(englishKorean).errors.some((error) => error.field === 'aaa.add.ko'));
  });

  test('rejects words that the sentences never use', () => {
    const detached = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      words: [
        { en: 'warm coffee', ko: '따뜻한 커피' },
        { en: 'umbrella', ko: '우산' },
        { en: 'subway line', ko: '지하철 노선' }
      ]
    }), {});
    const result = validateGeneratedContent(detached);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.field === 'words'));
  });

  test('rejects an Answer that has nothing to do with the picked sentence', () => {
    const unrelated = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      aaa: Object.assign({}, SAMPLE.aaa, {
        answer: { en: 'My sister lives in Canada.', ko: '제 여동생은 캐나다에 살아요.' }
      })
    }), {});
    assert.ok(validateGeneratedContent(unrelated).errors.some((error) => error.field === 'aaa.answer'));
  });

  test('accepts an Answer rephrased in conversation as long as it keeps a content word', () => {
    const rephrased = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      aaa: Object.assign({}, SAMPLE.aaa, {
        answer: { en: 'Yeah, I grabbed a warm coffee this morning.', ko: '네, 오늘 아침 따뜻한 커피를 사서 들었어요.' }
      })
    }), {});
    assert.deepEqual(validateGeneratedContent(rephrased), { ok: true, errors: [] });
  });
});

describe('buildContentId', () => {
  test('is TRACK-YYYYMMDD-topic-slug', () => {
    assert.equal(buildContentId('SMALL_TALK', '20261120', 'Warm Coffee Morning'), 'SMALL_TALK-20261120-warm-coffee-morning');
  });

  test('uses at most four slug words and strips punctuation', () => {
    assert.equal(buildContentId('BUSINESS', '20261120', "Let's Circle Back on the Deck!"), 'BUSINESS-20261120-let-s-circle-back');
  });

  test('adds a numeric suffix instead of reusing an id', () => {
    const existing = ['SMALL_TALK-20261120-warm-coffee-morning'];
    assert.equal(buildContentId('SMALL_TALK', '20261120', 'Warm coffee morning', existing), 'SMALL_TALK-20261120-warm-coffee-morning-2');
  });

  test('still produces an id for a non-Latin topic', () => {
    assert.equal(buildContentId('SMALL_TALK', '20261120', '주말 인사'), 'SMALL_TALK-20261120-daily-talk');
  });
});

describe('buildQueueRowValues', () => {
  const headerMap = {};
  RM_DAILY_TALK_GEN.QUEUE_HEADERS.forEach((header, index) => { headerMap[header] = index + 1; });
  headerMap.WORD_ORDER_JSON = 20;
  headerMap.STRUCTURE_JSON = 21;
  headerMap.SUBSTITUTIONS_JSON = 22;
  const content = normalizeGeneratedContent(SAMPLE, { track: 'SMALL_TALK', level: 'BASIC' });

  test('fills every existing 콘텐츠대기열 column by header name', () => {
    const row = buildQueueRowValues(headerMap, content, {
      contentId: 'SMALL_TALK-20261120-warm-coffee-morning',
      sendDate: '2026-11-20',
      status: 'DRAFT',
      sources: 'OPENAI:gpt-5.5',
      generatedAt: '2026-11-19T09:00:00Z'
    });
    assert.equal(row[headerMap.CONTENT_ID - 1], 'SMALL_TALK-20261120-warm-coffee-morning');
    assert.equal(row[headerMap['발송일'] - 1], '2026-11-20');
    assert.equal(row[headerMap['트랙'] - 1], 'SMALL_TALK');
    assert.equal(row[headerMap['레벨'] - 1], 'BASIC');
    assert.equal(row[headerMap['상태'] - 1], 'DRAFT');
    assert.equal(row[headerMap.TOPIC_EN - 1], SAMPLE.topicEn);
    assert.equal(row[headerMap.SNACK_KO - 1], SAMPLE.snackKo);
    assert.equal(row[headerMap.SOURCES - 1], 'OPENAI:gpt-5.5');
    assert.equal(row[headerMap['발송시각'] - 1], '');
    assert.equal(row[headerMap['오류'] - 1], '');
  });

  test('CHUNKS_JSON holds the three words of step 1', () => {
    const row = buildQueueRowValues(headerMap, content, { contentId: 'C1', sendDate: '2026-11-20' });
    const words = JSON.parse(row[headerMap.CHUNKS_JSON - 1]);
    assert.equal(words.length, 3);
    assert.deepEqual(words[0], SAMPLE.words[0]);
  });

  test('WORD_ORDER_JSON holds the three sentences with their word-order pieces', () => {
    const row = buildQueueRowValues(headerMap, content, { contentId: 'C1' });
    const rows = JSON.parse(row[19]);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].ko, SAMPLE.sentences[0].ko);
    assert.equal(rows[0].order.length, 5);
    assert.deepEqual(rows[0].order[0], { role: '누가', text: '나는' });
    assert.equal(rows[1].en, SAMPLE.sentences[1].en);
  });

  test('STRUCTURE_JSON holds the picked sentence and the AAA script', () => {
    const row = buildQueueRowValues(headerMap, content, { contentId: 'C1' });
    const structure = JSON.parse(row[20]);
    assert.equal(structure.type, 'AAA');
    assert.equal(structure.pick, 1);
    assert.deepEqual(structure.steps.map((step) => step.label), ['Answer', 'Add', 'Ask']);
    assert.equal(structure.steps[0].en, SAMPLE.aaa.answer.en);
  });

  test('MODEL_EN / MODEL_KO keep the three AAA lines, and YOUR_TURN the practice cue', () => {
    const row = buildQueueRowValues(headerMap, content, { contentId: 'C1' });
    assert.equal(row[headerMap.MODEL_EN - 1],
      'Answer: ' + SAMPLE.aaa.answer.en + '\nAdd: ' + SAMPLE.aaa.add.en + '\nAsk: ' + SAMPLE.aaa.ask.en);
    assert.includes(row[headerMap.MODEL_KO - 1], 'Answer: ' + SAMPLE.aaa.answer.ko);
    assert.equal(row[headerMap.YOUR_TURN_EN - 1], RM_DAILY_TALK_PRACTICE_CUE.en);
    assert.equal(row[headerMap.YOUR_TURN_KO - 1], RM_DAILY_TALK_PRACTICE_CUE.ko);
  });

  test('writes a Kakao teaser with the ad label and without a URL yet', () => {
    const row = buildQueueRowValues(headerMap, content, { contentId: 'C1' });
    const teaser = row[headerMap['카카오본문'] - 1];
    assert.includes(teaser, '(광고) 라이언멤버스 Ryan Daily Talk');
    assert.includes(teaser, SAMPLE.topicKo);
    assert.excludes(teaser, 'http');
  });

  test('defaults the status to DRAFT and ignores unmapped headers', () => {
    const narrow = { CONTENT_ID: 1, 트랙: 2, 상태: 3 };
    const row = buildQueueRowValues(narrow, content, { contentId: 'C1' });
    assert.deepEqual(row, ['C1', 'SMALL_TALK', 'DRAFT']);
  });
});

describe('findMissingTracks', () => {
  const queue = [
    { contentId: 'A', track: 'SMALL_TALK', dateKey: '2026-11-20' },
    { contentId: 'B', track: 'BUSINESS', dateKey: '2026-11-19' }
  ];

  test('returns only the tracks without a row for that day', () => {
    assert.deepEqual(findMissingTracks(queue, '2026-11-20', ['SMALL_TALK', 'BUSINESS']), ['BUSINESS']);
  });

  test('returns nothing when both tracks exist (idempotent daily run)', () => {
    const both = queue.concat([{ contentId: 'C', track: 'BUSINESS', dateKey: '2026-11-20' }]);
    assert.deepEqual(findMissingTracks(both, '2026-11-20', ['SMALL_TALK', 'BUSINESS']), []);
  });

  test('ignores rows of another day', () => {
    assert.deepEqual(findMissingTracks(queue, '2026-11-21', ['SMALL_TALK']), ['SMALL_TALK']);
  });

  test('a verification TEST row does not count as the day\'s content', () => {
    const withTest = [{ contentId: 'T1', track: 'SMALL_TALK', dateKey: '2026-11-20', status: 'TEST' }];
    assert.deepEqual(findMissingTracks(withTest, '2026-11-20', ['SMALL_TALK']), ['SMALL_TALK']);
  });

  test('a failed attempt is retried, while APPROVED and DRAFT are respected', () => {
    const rows = [
      { contentId: 'F1', track: 'SMALL_TALK', dateKey: '2026-11-20', status: 'FAILED' },
      { contentId: 'D1', track: 'BUSINESS', dateKey: '2026-11-20', status: 'draft' }
    ];
    assert.deepEqual(findMissingTracks(rows, '2026-11-20', ['SMALL_TALK', 'BUSINESS']), ['SMALL_TALK']);
  });
});

describe('recentTopicsForTrack', () => {
  test('returns that track only, newest first', () => {
    const queue = [
      { track: 'SMALL_TALK', topicEn: 'Coffee order' },
      { track: 'BUSINESS', topicEn: 'Deadline update' },
      { track: 'SMALL_TALK', topicEn: 'Weekend plans' }
    ];
    assert.deepEqual(recentTopicsForTrack(queue, 'SMALL_TALK', 5), ['Weekend plans', 'Coffee order']);
  });

  test('limits the lookback', () => {
    const queue = [];
    for (let i = 0; i < 20; i += 1) queue.push({ track: 'SMALL_TALK', topicEn: 'Topic ' + i });
    assert.equal(recentTopicsForTrack(queue, 'SMALL_TALK', 3).length, 3);
  });
});

describe('resolveModelChain', () => {
  test('puts the configured model first and de-duplicates', () => {
    const chain = resolveModelChain('gpt-5');
    assert.equal(chain[0], 'gpt-5');
    assert.equal(chain.filter((model) => model === 'gpt-5').length, 1);
    assert.includes(chain, RM_DAILY_TALK_GEN.DEFAULT_MODEL);
  });

  test('works with no configured model', () => {
    const chain = resolveModelChain('');
    assert.equal(chain[0], RM_DAILY_TALK_GEN.DEFAULT_MODEL);
  });

  test('never contains an empty entry', () => {
    assert.ok(resolveModelChain('  ').every((model) => model.length > 0));
  });
});

describe('isStorableGeneratedItem', () => {
  test('accepts a validated item with an id', () => {
    assert.equal(isStorableGeneratedItem({
      contentId: 'C1',
      content: normalizeGeneratedContent(SAMPLE, { track: 'SMALL_TALK', level: 'BASIC' })
    }), true);
  });

  test('rejects a missing id or invalid content', () => {
    assert.equal(isStorableGeneratedItem(null), false);
    assert.equal(isStorableGeneratedItem({ contentId: '', content: normalizeGeneratedContent(SAMPLE, {}) }), false);
    assert.equal(isStorableGeneratedItem({ contentId: 'C1', content: normalizeGeneratedContent({}, {}) }), false);
  });
});

describe('five-step constants', () => {
  test('the roles are the English word order the learner sees', () => {
    assert.deepEqual(RM_DAILY_TALK_ROLES.slice(), ['누가', '한다', '무엇을', '어디서', '언제', '어떻게']);
  });

  test('AAA is Answer / Add / Ask for both tracks', () => {
    assert.equal(RM_DAILY_TALK_AAA.TYPE, 'AAA');
    assert.deepEqual(RM_DAILY_TALK_AAA.STEPS.map((step) => step.label), ['Answer', 'Add', 'Ask']);
    assert.equal(RM_DAILY_TALK_AAA.STEPS[2].hint, '상대에게 되묻기');
  });

  test('legacy track scaffolding is still readable for old rows', () => {
    assert.equal(dailyTalkStructureTypeFor('SMALL_TALK'), 'AAA');
    assert.equal(dailyTalkStructureTypeFor('BUSINESS'), 'MESSAGE_HOUSE');
    assert.deepEqual(dailyTalkStructureLabels('MESSAGE_HOUSE'), ['Conclusion', 'Reason', 'Detail', 'Suggestion']);
  });
});

describe('generator safety boundary', () => {
  test('the generator module never calls a Kakao/SOLAPI send path', () => {
    const source = fs.readFileSync(path.join(ROOT, 'apps-script', 'DailyTalkContentGenerator.gs'), 'utf8');
    ['callSolapi_', 'dispatchKakaoMessages_', 'runDailyTalkPipeline', 'sendDailyTalkTestToOwner'].forEach((name) => {
      assert.excludes(source, name);
    });
  });

  test('the API key is read from Script Properties only', () => {
    const source = fs.readFileSync(path.join(ROOT, 'apps-script', 'DailyTalkContentGenerator.gs'), 'utf8');
    assert.includes(source, "getScriptProperty_('OPENAI_API_KEY')");
    assert.excludes(source, 'sk-');
  });
});
