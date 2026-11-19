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
  wordOrder: [
    { thoughtKo: '나는 / 주말에 / 집에서 / 쉬었다', orderKo: '나는 / 쉬었다 / 집에서 / 주말에', en: 'I stayed home over the weekend.' },
    { thoughtKo: '우리는 / 어제 / 산에 / 올라갔다', orderKo: '우리는 / 올라갔다 / 산에 / 어제', en: 'We hiked a mountain yesterday.' }
  ],
  structureType: 'AAA',
  structureSteps: [
    { label: 'Answer', en: 'I mostly stayed in.', ko: '거의 집에 있었어요.' },
    { label: 'Add', en: 'I cooked and watched a few movies at home.', ko: '집에서 요리하고 영화 몇 편을 봤어요.' },
    { label: 'Ask back', en: 'What about you?', ko: '당신은요?' }
  ],
  modelEn: 'A: How was your weekend?\nB: I mostly stayed in and cooked. What about you?\nA: I went hiking near Dalmaji.',
  modelKo: 'A: 주말은 어떻게 보냈어요?\nB: 거의 집에 있으면서 요리했어요. 당신은요?\nA: 달맞이길 근처로 등산을 갔어요.',
  substitutions: [
    { en: 'I went to the beach on Saturday.', ko: '토요일에 해변에 다녀왔어요.' },
    { en: 'I met some friends for dinner.', ko: '친구들을 만나 저녁을 먹었어요.' }
  ],
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
    ['topicEn', 'topicKo', 'snackEn', 'snackKo', 'chunks', 'modelEn', 'modelKo', 'yourTurnEn', 'yourTurnKo',
      'wordOrder', 'structureType', 'structureSteps', 'substitutions']
      .forEach((field) => assert.includes(prompt.user, field));
  });

  test('teaches the four steps in order', () => {
    const prompt = buildContentPrompt('SMALL_TALK', { level: 'BASIC' });
    const system = prompt.system;
    assert.includes(system, 'Step 1 Key Chunks');
    assert.includes(system, 'Step 2 Word Order');
    assert.includes(system, 'Step 3 Speaking Structure');
    assert.includes(system, 'Step 4 Model & Your Turn');
    assert.includes(system, 'subject / verb / object / place & time');
    assert.ok(system.indexOf('Step 1') < system.indexOf('Step 2'));
    assert.ok(system.indexOf('Step 2') < system.indexOf('Step 3'));
    assert.ok(system.indexOf('Step 3') < system.indexOf('Step 4'));
  });

  test('small talk grows with AAA and business with the message house', () => {
    const small = buildContentPrompt('SMALL_TALK', {});
    assert.equal(small.structureType, 'AAA');
    assert.includes(small.system, 'AAA: Answer, then Add a reason or detail, then Ask back');
    assert.includes(small.user, 'Answer, Add, Ask back');

    const business = buildContentPrompt('BUSINESS', {});
    assert.equal(business.structureType, 'MESSAGE_HOUSE');
    assert.includes(business.system, 'Conclusion first, then Reason, then Detail, then Suggestion');
    assert.includes(business.user, 'Conclusion, Reason, Detail, Suggestion');
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

  test('requires the step 2-4 structures with fixed sizes', () => {
    const schema = buildDailyTalkContentSchema();
    ['wordOrder', 'structureType', 'structureSteps', 'substitutions'].forEach((field) => {
      assert.includes(schema.required, field);
    });
    assert.equal(schema.properties.wordOrder.minItems, 2);
    assert.equal(schema.properties.wordOrder.maxItems, 2);
    assert.deepEqual(schema.properties.wordOrder.items.required, ['thoughtKo', 'orderKo', 'en']);
    assert.deepEqual(schema.properties.structureType.enum, ['AAA', 'MESSAGE_HOUSE']);
    assert.equal(schema.properties.structureSteps.minItems, 3);
    assert.equal(schema.properties.structureSteps.maxItems, 4);
    assert.includes(schema.properties.structureSteps.items.properties.label.enum, 'Ask back');
    assert.includes(schema.properties.structureSteps.items.properties.label.enum, 'Suggestion');
    assert.equal(schema.properties.substitutions.minItems, 2);
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

  test('rejects a word order row that is not Korean -> Korean order -> English', () => {
    const missing = normalizeGeneratedContent(Object.assign({}, SAMPLE, { wordOrder: [SAMPLE.wordOrder[0]] }), {});
    assert.ok(validateGeneratedContent(missing).errors.some((error) => error.field === 'wordOrder'));

    const englishThought = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      wordOrder: [{ thoughtKo: 'I stayed home', orderKo: '나는 쉬었다 집에서', en: 'I stayed home.' }]
    }), {});
    assert.ok(validateGeneratedContent(englishThought).errors.some((error) => error.field === 'wordOrder[0].thoughtKo'));

    const hangulSentence = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      wordOrder: [{ thoughtKo: '나는 / 쉬었다', orderKo: '나는 / 쉬었다', en: '나는 쉬었다' }]
    }), {});
    assert.ok(validateGeneratedContent(hangulSentence).errors.some((error) => error.field === 'wordOrder[0].en'));
  });

  test('accepts AAA for small talk and the message house for business', () => {
    const small = normalizeGeneratedContent(SAMPLE, { track: 'SMALL_TALK' });
    assert.equal(validateGeneratedContent(small).ok, true);
    assert.equal(small.structureType, 'AAA');

    const business = normalizeGeneratedContent({
      topicEn: 'Updating the team',
      topicKo: '팀에 상황 공유하기',
      snackEn: 'Tell the team about a delay before they ask.',
      snackKo: '물어보기 전에 팀에 지연을 먼저 알립니다.',
      chunks: [
        { en: 'I have a quick update.', ko: '간단히 공유드릴 게 있어요.' },
        { en: 'We need one more day.', ko: '하루가 더 필요합니다.' },
        { en: 'I will keep you posted.', ko: '계속 알려 드릴게요.' }
      ],
      wordOrder: [
        { thoughtKo: '우리 팀은 / 금요일까지 / 결과를 / 확인한다', orderKo: '우리 팀은 / 확인한다 / 결과를 / 금요일까지', en: 'Our team will check the result by Friday.' },
        { thoughtKo: '저는 / 내일 / 보고서를 / 보낸다', orderKo: '저는 / 보낸다 / 보고서를 / 내일', en: 'I will send the report tomorrow.' }
      ],
      structureType: 'MESSAGE_HOUSE',
      structureSteps: [
        { label: 'Conclusion', en: 'We need one more day for the launch.', ko: '출시에 하루가 더 필요합니다.' },
        { label: 'Reason', en: 'The final check found two bugs.', ko: '마지막 점검에서 오류 두 개를 찾았습니다.' },
        { label: 'Detail', en: 'Both are in the payment screen.', ko: '둘 다 결제 화면에 있습니다.' },
        { label: 'Suggestion', en: 'Could we move the launch to Friday?', ko: '출시를 금요일로 옮겨도 될까요?' }
      ],
      modelEn: 'A: I have a quick update.\nB: Sure, go ahead.',
      modelKo: 'A: 간단히 공유드릴 게 있어요.\nB: 네, 말씀하세요.',
      substitutions: [
        { en: 'Could we move the meeting to Friday?', ko: '회의를 금요일로 옮겨도 될까요?' },
        { en: 'Could we start a day later?', ko: '하루 늦게 시작해도 될까요?' }
      ],
      yourTurnEn: 'Tell your team about one small delay today.',
      yourTurnKo: '오늘 팀에 작은 지연을 하나 알려 보세요.'
    }, { track: 'BUSINESS' });
    const result = validateGeneratedContent(business);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  test('rejects a track whose structure does not match its scaffold', () => {
    const wrongType = normalizeGeneratedContent(Object.assign({}, SAMPLE, { structureType: 'MESSAGE_HOUSE' }), { track: 'SMALL_TALK' });
    assert.ok(validateGeneratedContent(wrongType).errors.some((error) => error.field === 'structureType'));

    const wrongOrder = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      structureSteps: [SAMPLE.structureSteps[1], SAMPLE.structureSteps[0], SAMPLE.structureSteps[2]]
    }), { track: 'SMALL_TALK' });
    assert.ok(validateGeneratedContent(wrongOrder).errors.some((error) => error.field === 'structureSteps[0].label'));

    const businessAsAaa = normalizeGeneratedContent(Object.assign({}, SAMPLE, { structureType: 'AAA' }), { track: 'BUSINESS' });
    assert.ok(validateGeneratedContent(businessAsAaa).errors.some((error) => error.field === 'structureType'));
  });

  test('rejects a swap list that is not exactly two bilingual rows', () => {
    const one = normalizeGeneratedContent(Object.assign({}, SAMPLE, { substitutions: [SAMPLE.substitutions[0]] }), {});
    assert.ok(validateGeneratedContent(one).errors.some((error) => error.field === 'substitutions'));

    const hangul = normalizeGeneratedContent(Object.assign({}, SAMPLE, {
      substitutions: [{ en: '해변에 다녀왔어요', ko: '해변에 다녀왔어요' }, SAMPLE.substitutions[1]]
    }), {});
    assert.ok(validateGeneratedContent(hangul).errors.some((error) => error.field === 'substitutions[0].en'));
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

  test('writes the step 2-4 lesson columns the publisher reads', () => {
    const wide = Object.assign({}, headerMap, {
      WORD_ORDER_JSON: 20, STRUCTURE_JSON: 21, SUBSTITUTIONS_JSON: 22
    });
    const row = buildQueueRowValues(wide, content, { contentId: 'C1' });
    const wordOrder = JSON.parse(row[19]);
    assert.equal(wordOrder.length, 2);
    assert.equal(wordOrder[0].orderKo, SAMPLE.wordOrder[0].orderKo);
    const structure = JSON.parse(row[20]);
    assert.equal(structure.type, 'AAA');
    assert.equal(structure.steps.length, 3);
    assert.equal(structure.steps[2].label, 'Ask back');
    const swaps = JSON.parse(row[21]);
    assert.equal(swaps.length, 2);
    assert.equal(swaps[0].en, SAMPLE.substitutions[0].en);
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

describe('dailyTalkStructureTypeFor / dailyTalkStructureLabels', () => {
  test('small talk grows with AAA, business with the message house', () => {
    assert.equal(dailyTalkStructureTypeFor('SMALL_TALK'), 'AAA');
    assert.equal(dailyTalkStructureTypeFor('BUSINESS'), 'MESSAGE_HOUSE');
    assert.equal(dailyTalkStructureTypeFor(''), 'AAA');
    assert.deepEqual(dailyTalkStructureLabels('AAA'), ['Answer', 'Add', 'Ask back']);
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
