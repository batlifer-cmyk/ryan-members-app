/**
 * Daily Talk content generator — pure-layer tests.
 * The generator is exercised through the exact .gs source that goes to Apps
 * Script; no network, Sheets or OpenAI call is made here.
 */
const fs = require('fs');
const path = require('path');

const SAMPLE = {
  topicEn: 'How Was Your Weekend?',
  topicKo: '주말은 어떻게 보냈어요?',
  snackEn: 'When a coworker asks about your weekend, a short answer plus one question keeps the chat going.',
  snackKo: '직장 동료가 주말 이야기를 물으면, 짧은 대답에 질문 하나를 더하면 대화가 이어집니다.',
  chunks: [
    { en: 'How was your weekend?', ko: '주말은 어떻게 보냈어요?' },
    { en: 'I mostly stayed in.', ko: '거의 집에 있었어요.' },
    { en: 'What about you?', ko: '당신은요?' }
  ],
  modelEn: 'A: How was your weekend?\nB: I mostly stayed in and cooked. What about you?\nA: I went hiking near Dalmaji.',
  modelKo: 'A: 주말은 어떻게 보냈어요?\nB: 거의 집에 있으면서 요리했어요. 당신은요?\nA: 달맞이길 근처로 등산을 갔어요.',
  yourTurnEn: 'Ask one coworker how their weekend was today.',
  yourTurnKo: '오늘 동료 한 명에게 주말이 어땠는지 물어보세요.'
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

  test('asks for every queue field in plain language', () => {
    const prompt = buildContentPrompt('SMALL_TALK', { level: 'BASIC' });
    ['topicEn', 'topicKo', 'snackEn', 'snackKo', 'chunks', 'modelEn', 'modelKo', 'yourTurnEn', 'yourTurnKo']
      .forEach((field) => assert.includes(prompt.user, field));
  });
});

describe('buildDailyTalkContentSchema', () => {
  test('is strict and requires every content field plus chunks', () => {
    const schema = buildDailyTalkContentSchema();
    assert.equal(schema.additionalProperties, false);
    RM_DAILY_TALK_GEN.CONTENT_FIELDS.forEach((field) => {
      assert.includes(schema.required, field);
    });
    assert.includes(schema.required, 'chunks');
    assert.equal(schema.properties.chunks.minItems, 3);
    assert.equal(schema.properties.chunks.items.additionalProperties, false);
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
  test('trims wrapping quotes, collapses newlines in single-line fields and keeps the dialogue breaks', () => {
    const content = normalizeGeneratedContent({
      topicEn: '  "How Was Your Weekend?"  ',
      topicKo: '주말은   어떻게 보냈어요?',
      snackEn: 'Line one.\nLine two.',
      snackKo: '한 줄.\n두 줄.',
      chunks: ['How was your weekend?', { en: 'I stayed in.', ko: '집에 있었어요.' }],
      modelEn: SAMPLE.modelEn,
      modelKo: SAMPLE.modelKo,
      yourTurnEn: SAMPLE.yourTurnEn,
      yourTurnKo: SAMPLE.yourTurnKo
    }, { track: 'BUSINESS', level: 'basic' });

    assert.equal(content.track, 'BUSINESS');
    assert.equal(content.level, 'BASIC');
    assert.equal(content.topicEn, 'How Was Your Weekend?');
    assert.equal(content.snackEn, 'Line one. Line two.');
    assert.equal(content.topicKo, '주말은 어떻게 보냈어요?');
    assert.equal(content.chunks.length, 2);
    assert.deepEqual(content.chunks[0], { en: 'How was your weekend?', ko: '' });
    assert.includes(content.modelEn, 'B:');
  });
});

describe('validateGeneratedContent', () => {
  test('accepts a complete bilingual item', () => {
    const result = validateGeneratedContent(normalizeGeneratedContent(SAMPLE, { track: 'SMALL_TALK', level: 'BASIC' }));
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

  test('rejects a missing or oversized chunk list', () => {
    const two = normalizeGeneratedContent(Object.assign({}, SAMPLE, { chunks: SAMPLE.chunks.slice(0, 2) }), {});
    assert.equal(validateGeneratedContent(two).ok, false);

    const five = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      chunks: SAMPLE.chunks.concat([{ en: 'See you.', ko: '또 봐요.' }, { en: 'Take care.', ko: '잘 지내요.' }])
    }), {});
    assert.equal(validateGeneratedContent(five).ok, false);
  });

  test('rejects a model answer that is not an A/B dialogue', () => {
    const content = normalizeGeneratedContent(Object.assign({}, SAMPLE, { modelEn: 'Just say hello.' }), {});
    const result = validateGeneratedContent(content);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.field === 'modelEn'));
  });

  test('reports every empty field at once', () => {
    const result = validateGeneratedContent({});
    assert.equal(result.ok, false);
    assert.equal(result.errors.filter((error) => error.message === '비어 있습니다.').length, 8);
  });
});

describe('buildContentId', () => {
  test('is TRACK-YYYYMMDD-topic-slug', () => {
    assert.equal(buildContentId('SMALL_TALK', '20261120', 'How Was Your Weekend?'), 'SMALL_TALK-20261120-how-was-your-weekend');
  });

  test('uses at most four slug words and strips punctuation', () => {
    assert.equal(buildContentId('BUSINESS', '20261120', "Let's Circle Back on the Deck!"), 'BUSINESS-20261120-let-s-circle-back');
  });

  test('adds a numeric suffix instead of reusing an id', () => {
    const existing = ['SMALL_TALK-20261120-how-was-your-weekend'];
    assert.equal(buildContentId('SMALL_TALK', '20261120', 'How was your weekend?', existing), 'SMALL_TALK-20261120-how-was-your-weekend-2');
  });

  test('still produces an id for a non-Latin topic', () => {
    assert.equal(buildContentId('SMALL_TALK', '20261120', '주말 인사'), 'SMALL_TALK-20261120-daily-talk');
  });
});

describe('buildQueueRowValues', () => {
  const headerMap = {};
  RM_DAILY_TALK_GEN.QUEUE_HEADERS.forEach((header, index) => { headerMap[header] = index + 1; });
  const content = normalizeGeneratedContent(SAMPLE, { track: 'SMALL_TALK', level: 'BASIC' });

  test('fills every existing 콘텐츠대기열 column by header name', () => {
    const row = buildQueueRowValues(headerMap, content, {
      contentId: 'SMALL_TALK-20261120-how-was-your-weekend',
      sendDate: '2026-11-20',
      status: 'DRAFT',
      sources: 'OPENAI:gpt-5.5',
      generatedAt: '2026-11-19T09:00:00Z'
    });
    assert.equal(row.length, RM_DAILY_TALK_GEN.QUEUE_HEADERS.length);
    assert.equal(row[headerMap.CONTENT_ID - 1], 'SMALL_TALK-20261120-how-was-your-weekend');
    assert.equal(row[headerMap['발송일'] - 1], '2026-11-20');
    assert.equal(row[headerMap['트랙'] - 1], 'SMALL_TALK');
    assert.equal(row[headerMap['레벨'] - 1], 'BASIC');
    assert.equal(row[headerMap['상태'] - 1], 'DRAFT');
    assert.equal(row[headerMap.TOPIC_EN - 1], SAMPLE.topicEn);
    assert.equal(row[headerMap.SNACK_KO - 1], SAMPLE.snackKo);
    assert.equal(row[headerMap.MODEL_KO - 1], SAMPLE.modelKo);
    assert.equal(row[headerMap.YOUR_TURN_EN - 1], SAMPLE.yourTurnEn);
    assert.equal(row[headerMap.SOURCES - 1], 'OPENAI:gpt-5.5');
    assert.equal(row[headerMap['생성시각'] - 1], '2026-11-19T09:00:00Z');
    assert.equal(row[headerMap['발송시각'] - 1], '');
    assert.equal(row[headerMap['오류'] - 1], '');
  });

  test('stores chunks as JSON the publisher can parse', () => {
    const row = buildQueueRowValues(headerMap, content, { contentId: 'C1', sendDate: '2026-11-20' });
    const chunks = JSON.parse(row[headerMap.CHUNKS_JSON - 1]);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].en, SAMPLE.chunks[0].en);
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

  test('places the publication columns when the sheet has them', () => {
    const wide = Object.assign({}, headerMap, { WIX_CONTENT_URL: 20, WIX_POST_ID: 21 });
    const row = buildQueueRowValues(wide, content, { contentId: 'C1' });
    assert.equal(row.length, 21);
    assert.equal(row[19], '');
    assert.equal(row[20], '');
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
