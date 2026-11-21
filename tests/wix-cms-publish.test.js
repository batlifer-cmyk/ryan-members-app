/**
 * Wix CMS publication of Ryan Daily Talk content.
 *
 * The site serves Daily Talk at /rm-magazine/{slug} from the CMS collection
 * RyanDailyTalkContent, so these tests pin:
 *   - the queue -> CMS field mapping (name for name),
 *   - the five-step lesson body written into contentRich / contentHtml
 *     (2026-11-20) and the older four-step body still rendered for rows
 *     generated before that date,
 *   - the slug / publishDate rules taken from the live items,
 *   - insert on a free slug and patch on an existing one (wix-data/v2),
 *   - error handling that never leaks the API key,
 *   - the queue write-back of WIX_CONTENT_URL / WIX_POST_ID / WIX_PUBLISHED_AT.
 */

const FAKE_KEY = ['dummy', 'wix', 'credential', 'value'].join('-');

const ITEM = {
  contentId: 'SMALL_TALK-20261120-warm-coffee-morning',
  sendDate: '2026-11-20',
  track: 'SMALL_TALK',
  level: 'BASIC',
  status: 'TEST',
  topicEn: 'Warm Coffee Morning',
  topicKo: '따뜻한 커피 아침',
  snackEn: 'You walk to work on a cold morning and stop for a coffee. Today you say what you drink on the way.',
  snackKo: '추운 아침에 걸어서 출근하다가 커피를 사요. 오늘은 출근길에 무엇을 마시는지 말해 봅니다.',
  chunksJson: JSON.stringify([
    { en: 'warm coffee', ko: '따뜻한 커피' },
    { en: 'on my way to work', ko: '출근길에' },
    { en: 'grab', ko: '(음료를) 사서 들다' }
  ]),
  wordOrderJson: JSON.stringify([
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
  ]),
  structureJson: JSON.stringify({
    type: 'AAA',
    pick: 1,
    steps: [
      { label: 'Answer', en: 'Yeah, I had a warm coffee on my way to work.', ko: '네, 출근길에 따뜻한 커피를 마셨어요.' },
      { label: 'Add', en: 'It was freezing outside.', ko: '밖이 정말 추웠거든요.' },
      { label: 'Ask', en: 'How about you?', ko: '당신은요?' }
    ]
  }),
  modelEn: 'Answer: Yeah, I had a warm coffee on my way to work.\nAdd: It was freezing outside.\nAsk: How about you?',
  modelKo: 'Answer: 네, 출근길에 따뜻한 커피를 마셨어요.\nAdd: 밖이 정말 추웠거든요.\nAsk: 당신은요?',
  yourTurnEn: 'Say your Answer, Add and Ask out loud three times today.',
  yourTurnKo: '오늘 Answer → Add → Ask 세 문장을 소리 내어 세 번 말해 보세요.',
  sources: 'OPENAI:gpt-5.5',
  kakaoText: '',
  wixContentUrl: '',
  wixPostId: '',
  wixPublishedAt: ''
};

/** A row generated before 2026-11-20: the older four-step body. */
const LEGACY_ITEM = {
  contentId: 'SMALL_TALK-20261119-cold-morning-chat',
  sendDate: '2026-11-19',
  track: 'SMALL_TALK',
  level: 'BASIC',
  topicEn: 'Frosty Elevator Hello',
  topicKo: '쌀쌀한 엘리베이터 인사',
  snackEn: "You meet a neighbor in the elevator on a very cold morning. Try one expression today: It's freezing this morning.",
  snackKo: '아주 추운 아침에 엘리베이터에서 이웃을 만났어요. 오늘은 간단한 표현 하나를 써 보세요.',
  chunksJson: JSON.stringify([{ en: "It's freezing this morning.", ko: '오늘 아침 정말 춥네요.' }]),
  wordOrderJson: JSON.stringify([
    { thoughtKo: '오늘 아침은 / 정말 / 춥다', orderKo: '오늘 아침은 / 춥다 / 정말', en: "It's really cold this morning." }
  ]),
  structureJson: JSON.stringify({
    type: 'AAA',
    steps: [
      { label: 'Answer', en: "Yeah, it's really cold.", ko: '네, 정말 춥네요.' },
      { label: 'Add', en: 'I need warmer gloves.', ko: '더 따뜻한 장갑이 필요해요.' },
      { label: 'Ask back', en: 'Are you staying warm?', ko: '따뜻하게 지내세요?' }
    ]
  }),
  substitutionsJson: JSON.stringify([{ en: 'I need warmer gloves.', ko: '더 따뜻한 장갑이 필요하겠어요.' }]),
  modelEn: "A: Good morning. It's freezing this morning.\nB: Yeah, it's really cold.",
  modelKo: 'A: 좋은 아침이에요. 오늘 아침 정말 춥네요.\nB: 네, 정말 추워요.',
  yourTurnEn: "Try saying, It's freezing this morning, to a neighbor.",
  yourTurnKo: '오늘 이웃에게 오늘 아침 정말 춥네요라고 말해 보세요.',
  sources: 'OPENAI:gpt-5.5'
};

const BUSINESS_ITEM = {
  contentId: 'BUSINESS-20261120-one-more-day',
  track: 'BUSINESS',
  level: 'INTERMEDIATE',
  topicEn: 'One more day',
  topicKo: '하루 더 필요한 상황',
  chunksJson: JSON.stringify([
    { en: 'one more day', ko: '하루 더' },
    { en: 'push the launch', ko: '출시를 미루다' },
    { en: 'keep you posted', ko: '계속 알려 주다' }
  ]),
  wordOrderJson: JSON.stringify([
    {
      ko: '우리는 출시에 하루가 더 필요합니다',
      order: [
        { role: '누가', text: '우리는' },
        { role: '한다', text: '필요합니다' },
        { role: '무엇을', text: '하루가 더' },
        { role: '어디서', text: '출시에' }
      ],
      en: 'We need one more day for the launch.'
    }
  ]),
  structureJson: JSON.stringify({
    type: 'AAA',
    pick: 1,
    steps: [
      { label: 'Answer', en: 'We need one more day for the launch.', ko: '출시에 하루가 더 필요합니다.' },
      { label: 'Add', en: 'The final check found two bugs.', ko: '마지막 점검에서 오류 두 개가 나왔습니다.' },
      { label: 'Ask', en: 'Does Friday still work for you?', ko: '금요일도 괜찮으실까요?' }
    ]
  }),
  modelEn: 'We may need to push the deadline by a day.',
  modelKo: '마감을 하루 미뤄야 할 것 같습니다.',
  yourTurnEn: 'Tell your team about a small delay.',
  yourTurnKo: '팀에 작은 지연을 알려 보세요.',
  sources: 'OPENAI:gpt-5.5'
};

/** A business row generated after the 2026-11-21 Message House change. */
const BUSINESS_MESSAGE_HOUSE_ITEM = {
  contentId: 'BUSINESS-20261121-one-more-day',
  sendDate: '2026-11-21',
  track: 'BUSINESS',
  level: 'BASIC',
  topicEn: 'One More Day',
  topicKo: '하루 더 필요한 상황',
  snackEn: 'The final check found two bugs. Today you tell your team the launch needs one more day.',
  snackKo: '마지막 점검에서 오류 두 개가 나왔습니다. 오늘은 팀에 출시가 하루 더 필요하다고 말합니다.',
  chunksJson: JSON.stringify([
    { en: 'one more day', ko: '하루 더' },
    { en: 'push the launch', ko: '출시를 미루다' },
    { en: 'keep you posted', ko: '계속 알려 주다' }
  ]),
  wordOrderJson: JSON.stringify([
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
  ]),
  structureJson: JSON.stringify({
    type: 'MESSAGE_HOUSE',
    pick: 1,
    steps: [
      { label: 'Conclusion', en: 'We need one more day for the launch.', ko: '출시에 하루가 더 필요합니다.' },
      { label: 'Reason', en: 'The final check found two bugs.', ko: '마지막 점검에서 오류 두 개가 나왔습니다.' },
      { label: 'Detail', en: 'Both are on the payment screen.', ko: '둘 다 결제 화면에 있습니다.' },
      { label: 'Suggestion', en: 'Could we push the launch to Friday?', ko: '출시를 금요일로 미룰 수 있을까요?' }
    ]
  }),
  modelEn: 'Conclusion: We need one more day for the launch.\nReason: The final check found two bugs.\nDetail: Both are on the payment screen.\nSuggestion: Could we push the launch to Friday?',
  modelKo: 'Conclusion: 출시에 하루가 더 필요합니다.\nReason: 마지막 점검에서 오류 두 개가 나왔습니다.\nDetail: 둘 다 결제 화면에 있습니다.\nSuggestion: 출시를 금요일로 미룰 수 있을까요?',
  yourTurnEn: 'Say your business message out loud three times today: Conclusion first, then Reason, Detail and Suggestion.',
  yourTurnKo: '오늘 업무 메시지를 소리 내어 세 번 말해 보세요. 결론 → 근거 → 디테일, 필요하면 제안까지.',
  sources: 'OPENAI:gpt-5.5'
};

/** The same card where no next step was needed: three sentences only. */
const BUSINESS_MESSAGE_HOUSE_SHORT_ITEM = Object.assign({}, BUSINESS_MESSAGE_HOUSE_ITEM, {
  contentId: 'BUSINESS-20261121-one-more-day-short',
  structureJson: JSON.stringify({
    type: 'MESSAGE_HOUSE',
    pick: 1,
    steps: JSON.parse(BUSINESS_MESSAGE_HOUSE_ITEM.structureJson).steps.slice(0, 3)
  })
});

// --- stub plumbing ---------------------------------------------------------

/** A business news card (2026-11-21): news briefing + 5 keywords x 2 drills. */
const NEWS_KEYWORDS = [
  { en: 'hold rates steady', ko: '금리를 동결하다', usageKo: '연준이 기준금리를 그대로 두었다는 뜻으로 쓰였습니다.',
    drills: [
      { en: 'The Fed held rates steady at its November meeting.', ko: '연준은 11월 회의에서 금리를 동결했습니다.', highlight: 'held rates steady' },
      { en: "We're holding prices steady through the quarter.", ko: '우리는 이번 분기 동안 가격을 동결하고 있습니다.', highlight: 'holding prices steady' }
    ] },
  { en: 'signal a cut', ko: '인하 신호를 보내다', usageKo: '다음 회의에서 금리를 내릴 수 있다는 신호를 줬습니다.',
    drills: [
      { en: 'The Fed signaled a cut in December.', ko: '연준은 12월 인하 신호를 보냈습니다.', highlight: 'signaled a cut' },
      { en: 'The report signals a cut in our budget.', ko: '그 보고서는 예산 축소 신호를 보여 줍니다.', highlight: 'signals a cut' }
    ] },
  { en: 'inflation report', ko: '물가 보고서', usageKo: '금리 결정 전에 나온 물가 보고서가 근거로 언급되었습니다.',
    drills: [
      { en: 'The inflation report came out before the meeting.', ko: '물가 보고서는 회의 전에 나왔습니다.', highlight: 'inflation report' },
      { en: 'I read the inflation report on my commute.', ko: '출근길에 물가 보고서를 읽었습니다.', highlight: 'inflation report' }
    ] },
  { en: 'policy meeting', ko: '정책 회의', usageKo: '연준의 정책 회의 결과가 시장의 관심을 모았습니다.',
    drills: [
      { en: 'The policy meeting ended at two oclock.', ko: '정책 회의는 두 시에 끝났습니다.', highlight: 'policy meeting' },
      { en: 'Our policy meeting is on Thursday.', ko: '우리 정책 회의는 목요일에 있습니다.', highlight: 'policy meeting' }
    ] },
  { en: 'rate cut', ko: '금리 인하', usageKo: '연내 금리 인하 가능성이 낮아졌다는 해석이 나왔습니다.',
    drills: [
      { en: 'Investors expect one more rate cut this year.', ko: '투자자들은 올해 금리 인하가 한 번 더 있을 것으로 봅니다.', highlight: 'rate cut' },
      { en: 'A rate cut would help our loan.', ko: '금리 인하면 우리 대출에 도움이 됩니다.', highlight: 'rate cut' }
    ] }
];

const NEWS_SUMMARY = [
  '미 연방준비제도가 기준금리를 3.75%로 동결했습니다.',
  '물가가 목표치에 가까워졌지만 인하 시점은 더 지켜보겠다고 발표했습니다.',
  '한국은행도 당분간 금리를 유지할 가능성이 커졌습니다.'
];

const NEWS_ITEM = {
  contentId: 'BUSINESS-20261121-rates-on-hold',
  sendDate: '2026-11-21',
  track: 'BUSINESS',
  level: 'BASIC',
  topicEn: 'Rates On Hold',
  topicKo: '금리 동결',
  chunksJson: JSON.stringify(NEWS_KEYWORDS.map((word) => ({ en: word.en, ko: word.ko, usageKo: word.usageKo }))),
  wordOrderJson: '',
  structureJson: JSON.stringify({
    type: 'NEWS_DRILLS',
    news: {
      headlineEn: 'Fed holds rates steady, signals one more cut',
      summaryKo: NEWS_SUMMARY,
      sources: [{ title: '연준, 기준금리 동결', publisher: '매일경제', date: '2026-11-21', url: 'https://www.mk.co.kr/news/economy/1' }]
    },
    keywords: NEWS_KEYWORDS
  }),
  modelEn: 'Fed holds rates steady, signals one more cut',
  modelKo: NEWS_SUMMARY.join('\n'),
  yourTurnEn: 'Say all ten sentences out loud today: two pattern drills for each of the five keywords.',
  yourTurnKo: '오늘 문장 10개를 소리 내어 말해 보세요. 키워드 다섯 개마다 두 문장씩입니다.',
  sources: 'OPENAI:gpt-5.5\nhttps://www.mk.co.kr/news/economy/1'
};

function withServiceStubs(stubs, fn) {
  const merged = Object.assign({ Utilities: fakeUtilities() }, stubs || {});
  const applied = Object.keys(merged);
  const previous = {};
  applied.forEach((key) => {
    previous[key] = global.__sandbox[key];
    global.__sandbox[key] = merged[key];
  });
  try {
    return fn();
  } finally {
    applied.forEach((key) => {
      if (previous[key] === undefined) delete global.__sandbox[key];
      else global.__sandbox[key] = previous[key];
    });
  }
}

function fakeUtilities() {
  let counter = 0;
  return {
    getUuid: () => 'uuid-' + (++counter),
    formatDate: (date, timezone, pattern) => {
      const iso = new Date(date).toISOString().slice(0, 10);
      return pattern === 'yyyy-MM-dd' ? iso : iso;
    }
  };
}

function fakeProperties(values) {
  return {
    getScriptProperties: () => ({
      getProperty: (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null),
      setProperty: () => {}
    })
  };
}

function fakeResponse(code, body) {
  return {
    getResponseCode: () => code,
    getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

/** Records every UrlFetchApp call and answers from a queue of [code, body]. */
function fakeUrlFetch(answers) {
  const calls = [];
  const pending = answers.slice();
  return {
    calls,
    fetch(url, options) {
      calls.push({ url, options });
      const next = pending.length > 1 ? pending.shift() : pending[0];
      if (!next) throw new Error('unexpected fetch: ' + url);
      return fakeResponse(next[0], next[1]);
    }
  };
}

function parseBody(call) {
  return JSON.parse(call.options.payload);
}

function stubSheet() {
  const cells = {};
  return {
    cells,
    getRange(row, column) {
      return {
        setValue(value) {
          cells[`${row}:${column}`] = value;
        }
      };
    }
  };
}

function richTexts(item, options) {
  return buildDailyTalkCmsData_(item, options || {}).contentRich.nodes.map((node) => node.nodes[0].textData.text);
}

// --- field mapping ---------------------------------------------------------

describe('Daily Talk CMS payload', () => {
  test('maps every queue field to its RyanDailyTalkContent field name', () => {
    const data = buildDailyTalkCmsData_(ITEM, { slug: 'small-talk-2026-11-20-warm-coffee-morning' });
    assert.equal(data.contentId, ITEM.contentId, 'contentId');
    assert.equal(data.topicEn, ITEM.topicEn, 'TOPIC_EN -> topicEn');
    assert.equal(data.topicKo, ITEM.topicKo, 'TOPIC_KO -> topicKo');
    assert.equal(data.snackEn, ITEM.snackEn, 'SNACK_EN -> snackEn');
    assert.equal(data.snackKo, ITEM.snackKo, 'SNACK_KO -> snackKo');
    assert.equal(data.modelAnswerEn, ITEM.modelEn, 'MODEL_EN -> modelAnswerEn');
    assert.equal(data.modelAnswerKo, ITEM.modelKo, 'MODEL_KO -> modelAnswerKo');
    assert.equal(data.yourTurnEn, ITEM.yourTurnEn, 'YOUR_TURN_EN -> yourTurnEn');
    assert.equal(data.yourTurnKo, ITEM.yourTurnKo, 'YOUR_TURN_KO -> yourTurnKo');
    assert.ok(data.kakaoText.indexOf('따뜻한 커피 아침') !== -1, '카카오본문 -> kakaoText');
    assert.equal(data.generatedByAi, true, 'SOURCES OPENAI -> generatedByAi');
    assert.equal(data.status, 'PUBLISHED', 'status');
    assert.equal(data.track, 'SMALL_TALK', 'track');
    assert.equal(data.level, 'BASIC', 'level');
  });

  test('never sends a field the collection does not declare', () => {
    const data = buildDailyTalkCmsData_(ITEM, { slug: 'small-talk-2026-11-20-warm-coffee-morning' });
    const allowed = [
      'contentId', 'slug', 'title', 'track', 'level', 'status', 'publishDate', 'magazineUrl',
      'topicEn', 'topicKo', 'snackEn', 'snackKo', 'chunksJson', 'modelAnswerEn', 'modelAnswerKo',
      'yourTurnEn', 'yourTurnKo', 'sourceUrls', 'contentRich', 'contentHtml', 'kakaoText', 'generatedByAi'
    ];
    Object.keys(data).forEach((key) => {
      assert.ok(allowed.indexOf(key) !== -1, `unexpected CMS field: ${key}`);
    });
    ['modelEn', 'modelKo', 'chunks', '카카오본문'].forEach((rawName) => {
      assert.ok(!Object.prototype.hasOwnProperty.call(data, rawName), `queue-only name leaked: ${rawName}`);
    });
  });

  test('publishDate comes from CONTENT_ID as YYYY-MM-DD', () => {
    assert.equal(buildDailyTalkCmsData_(ITEM).publishDate, '2026-11-20');
    assert.equal(buildDailyTalkCmsData_({ contentId: 'X', sendDate: '2026-08-10' }).publishDate, '2026-08-10');
    assert.equal(buildDailyTalkCmsData_({ sendDate: '2026. 8. 10' }).publishDate, '2026-08-10');
  });

  test('chunksJson carries the three words of step 1', () => {
    const data = buildDailyTalkCmsData_(ITEM);
    const chunks = JSON.parse(data.chunksJson);
    assert.equal(chunks.length, 3);
    assert.deepEqual(chunks[0], { en: 'warm coffee', ko: '따뜻한 커피' });
    const fromLines = JSON.parse(buildDailyTalkCmsData_({ chunksJson: 'stay late: 야근하다\nwrap up: 마무리하다' }).chunksJson);
    assert.deepEqual(fromLines, [{ en: 'stay late', ko: '야근하다' }, { en: 'wrap up', ko: '마무리하다' }]);
    assert.equal(buildDailyTalkCmsData_({ chunksJson: '' }).chunksJson, '[]');
  });

  test('title follows the existing "[Small Talk] 주제" pattern', () => {
    assert.equal(buildDailyTalkCmsData_(ITEM).title, '[Small Talk] 따뜻한 커피 아침');
    assert.equal(buildDailyTalkCmsData_(BUSINESS_ITEM).title, '[Business Talk] 하루 더 필요한 상황');
  });

  test('kakaoText links to the magazine item and keeps the opt-out footer', () => {
    const data = buildDailyTalkCmsData_(ITEM, { slug: 'small-talk-2026-11-20-warm-coffee-morning' });
    assert.equal(data.magazineUrl, 'https://www.ryanmembers.com/rm-magazine/small-talk-2026-11-20-warm-coffee-morning');
    assert.includes(data.kakaoText, '(광고)');
    assert.includes(data.kakaoText, data.magazineUrl);
    assert.includes(data.kakaoText, '수신거부');
  });

  test('an existing 카카오본문 in the queue wins over the generated body', () => {
    const data = buildDailyTalkCmsData_(Object.assign({}, ITEM, { kakaoText: '미리 쓴 본문' }));
    assert.equal(data.kakaoText, '미리 쓴 본문');
  });
});

// --- the five-step body ----------------------------------------------------

describe('Daily Talk CMS body — five steps', () => {
  test('contentRich carries the five step headings in teaching order, once each', () => {
    const texts = richTexts(ITEM);
    const titles = ['STEP 1 · KEY WORDS', 'STEP 2 · KOREAN SENTENCES', 'STEP 3 · ENGLISH WORD ORDER',
      'STEP 4 · ENGLISH SENTENCES', 'STEP 5 · AAA IN ACTION'];
    const positions = titles.map((title) => texts.indexOf(title));
    assert.ok(positions.every((index) => index > -1), 'every step heading exists: ' + positions.join(','));
    assert.ok(positions[0] < positions[1] && positions[1] < positions[2] &&
      positions[2] < positions[3] && positions[3] < positions[4], 'steps are in order');
    assert.equal(texts.filter((text) => /^STEP [1-5] · /.test(text)).length, 5);
  });

  test('step 1 lists the three words with their meanings', () => {
    const texts = richTexts(ITEM);
    assert.includes(texts, 'warm coffee\n따뜻한 커피');
    assert.includes(texts, 'on my way to work\n출근길에');
    assert.includes(texts, 'grab\n(음료를) 사서 들다');
    assert.includes(texts, '오늘 질문에 답하려면 꼭 필요한 단어 3개. 뜻과 함께 소리 내어 세 번씩 읽어 보세요.');
  });

  test('step 2 lists the same three sentences in Korean, numbered', () => {
    const texts = richTexts(ITEM);
    assert.includes(texts, '오늘 질문에 대한 대답을 세 문장으로 나눈 것입니다. ① Answer(답변) → ② Add(이유·디테일) → ③ Ask(되묻기) 순서로 확인하세요.');
    assert.includes(texts, '① 나는 오늘 아침 출근길에 따뜻한 커피를 마셨다');
    assert.includes(texts, '② 나는 출근길에 커피를 사서 들었다');
    assert.includes(texts, '③ 나는 아침에 따뜻한 커피가 필요하다');
  });

  test('step 3 writes each sentence as role-labelled Korean pieces in English order', () => {
    const texts = richTexts(ITEM);
    assert.includes(texts, '① 누가: 나는 / 한다: 마셨다 / 무엇을: 따뜻한 커피를 / 어디서: 출근길에 / 언제: 오늘 아침');
    assert.includes(texts, '② 누가: 나는 / 한다: 사서 들었다 / 무엇을: 커피를 / 어디서: 출근길에');
    assert.includes(texts, '통역하기 전에, 한국어를 영어 어순(누가 → 한다 → 무엇을 → 어디서 → 언제)으로 먼저 놓아 봅니다.');
  });

  test('step 4 lists the English translations under the same marks', () => {
    const texts = richTexts(ITEM);
    assert.includes(texts, '① I had a warm coffee on my way to work this morning.');
    assert.includes(texts, '② I grabbed a coffee on my way to work.');
    assert.includes(texts, '③ I need a warm coffee in the morning.');
  });

  test('step 5 names the picked sentence and writes Answer / Add / Ask', () => {
    const texts = richTexts(ITEM);
    assert.includes(texts, '이제 오늘 질문에, 방금 연습한 ① 문장에서 시작해 Answer → Add → Ask 세 문장으로 답합니다.');
    assert.includes(texts, 'Answer — 한 문장으로 먼저 답하기\nYeah, I had a warm coffee on my way to work.\n네, 출근길에 따뜻한 커피를 마셨어요.');
    assert.includes(texts, 'Add — 이유나 디테일을 한 문장 더하기\nIt was freezing outside.\n밖이 정말 추웠거든요.');
    assert.includes(texts, 'Ask — 상대에게 되묻기\nHow about you?\n당신은요?');
  });

  test('the picked sentence drives the step 5 lead, not always ①', () => {
    const second = Object.assign({}, ITEM, {
      structureJson: JSON.stringify({
        type: 'AAA',
        pick: 2,
        steps: JSON.parse(ITEM.structureJson).steps
      })
    });
    const texts = richTexts(second);
    assert.includes(texts, '이제 오늘 질문에, 방금 연습한 ② 문장에서 시작해 Answer → Add → Ask 세 문장으로 답합니다.');
  });

  test('a business row generated before the Message House change keeps its AAA step 5', () => {
    const texts = richTexts(BUSINESS_ITEM);
    assert.includes(texts, 'STEP 1 · KEY WORDS');
    assert.includes(texts, 'STEP 3 · ENGLISH WORD ORDER');
    assert.includes(texts, 'STEP 5 · AAA IN ACTION');
    assert.includes(texts, '① 누가: 우리는 / 한다: 필요합니다 / 무엇을: 하루가 더 / 어디서: 출시에');
    assert.includes(texts, 'Answer — 한 문장으로 먼저 답하기\nWe need one more day for the launch.\n출시에 하루가 더 필요합니다.');
    assert.excludes(texts.join('|'), 'MESSAGE HOUSE');
  });

  test('a business Message House row publishes STEP 5 · MESSAGE HOUSE with four sentences', () => {
    const texts = richTexts(BUSINESS_MESSAGE_HOUSE_ITEM);
    assert.includes(texts, 'STEP 5 · MESSAGE HOUSE');
    assert.excludes(texts.join('|'), 'STEP 5 · AAA IN ACTION');
    assert.includes(texts, '업무 메시지는 결론부터. 오늘 문장 ①에서 출발해 Conclusion → Reason → Detail, 필요하면 Suggestion까지 세~네 문장으로 말합니다.');
    assert.includes(texts, 'Conclusion — 핵심 결론부터 말하기\nWe need one more day for the launch.\n출시에 하루가 더 필요합니다.');
    assert.includes(texts, 'Reason — 근거 기둥 세우기\nThe final check found two bugs.\n마지막 점검에서 오류 두 개가 나왔습니다.');
    assert.includes(texts, 'Detail — 구체적인 디테일 붙이기\nBoth are on the payment screen.\n둘 다 결제 화면에 있습니다.');
    assert.includes(texts, 'Suggestion — 다음 행동 제안하기\nCould we push the launch to Friday?\n출시를 금요일로 미룰 수 있을까요?');

    const labels = ['STEP 1 · KEY WORDS', 'STEP 2 · KOREAN SENTENCES', 'STEP 3 · ENGLISH WORD ORDER',
      'STEP 4 · ENGLISH SENTENCES', 'STEP 5 · MESSAGE HOUSE'];
    const positions = labels.map((title) => texts.indexOf(title));
    assert.ok(positions.every((index) => index > -1), 'every step heading exists: ' + positions.join(','));
  });

  test('a three-sentence Message House leaves Suggestion out', () => {
    const texts = richTexts(BUSINESS_MESSAGE_HOUSE_SHORT_ITEM);
    assert.includes(texts, 'STEP 5 · MESSAGE HOUSE');
    assert.includes(texts, 'Conclusion — 핵심 결론부터 말하기\nWe need one more day for the launch.\n출시에 하루가 더 필요합니다.');
    assert.excludes(texts.join('|'), 'Suggestion —');
  });

  test('the Message House lead names the sentence it picked', () => {
    const second = Object.assign({}, BUSINESS_MESSAGE_HOUSE_ITEM, {
      structureJson: JSON.stringify(Object.assign({}, JSON.parse(BUSINESS_MESSAGE_HOUSE_ITEM.structureJson), { pick: 2 }))
    });
    assert.includes(richTexts(second), '업무 메시지는 결론부터. 오늘 문장 ②에서 출발해 Conclusion → Reason → Detail, 필요하면 Suggestion까지 세~네 문장으로 말합니다.');
  });

  test('the Message House body is mirrored in contentHtml with its own class', () => {
    const html = buildDailyTalkCmsData_(BUSINESS_MESSAGE_HOUSE_ITEM).contentHtml;
    assert.includes(html, '<h3 class="dt-step-title">STEP 5 · MESSAGE HOUSE</h3>');
    assert.includes(html, '<p class="dt-aaa dt-message-house">Conclusion — 핵심 결론부터 말하기<br>We need one more day for the launch.<br>출시에 하루가 더 필요합니다.</p>');
  });

  test('contentHtml mirrors the five steps and escapes markup', () => {
    const html = buildDailyTalkCmsData_(ITEM).contentHtml;
    assert.includes(html, '<h3 class="dt-step-title">STEP 1 · KEY WORDS</h3>');
    assert.includes(html, '<p class="dt-word">warm coffee<br>따뜻한 커피</p>');
    assert.includes(html, '<p class="dt-order">① 누가: 나는 / 한다: 마셨다 / 무엇을: 따뜻한 커피를 / 어디서: 출근길에 / 언제: 오늘 아침</p>');
    assert.includes(html, '<p class="dt-english">① I had a warm coffee on my way to work this morning.</p>');
    assert.includes(html, '<p class="dt-aaa">Ask — 상대에게 되묻기<br>How about you?<br>당신은요?</p>');

    const escaped = buildDailyTalkCmsData_({ topicEn: 'Use <b>bold</b> & "quotes"', topicKo: '한글' }).contentHtml;
    assert.includes(escaped, '<h2 class="dt-topic-en">Use &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot;</h2>');
    assert.includes(escaped, '<p class="dt-topic-ko">한글</p>');
  });

  test('contentRich nodes are the Ricos shape the CMS accepts', () => {
    const rich = buildDailyTalkCmsData_(ITEM).contentRich;
    assert.ok(Array.isArray(rich.nodes));
    const heading = rich.nodes[0];
    assert.equal(heading.type, 'HEADING');
    assert.equal(heading.headingData.level, 2);
    assert.equal(heading.headingData.textStyle.textAlignment, 'AUTO');
    assert.equal(heading.nodes[0].type, 'TEXT');
    assert.deepEqual(heading.nodes[0].textData.decorations, []);
    const paragraph = rich.nodes[1];
    assert.equal(paragraph.type, 'PARAGRAPH');
    assert.equal(paragraph.paragraphData.textStyle.textAlignment, 'AUTO');
  });
});

// --- the business news card (2026-11-21) ----------------------------------

describe('Daily Talk CMS body — business news card', () => {
  test('opens with the news briefing: headline, Korean lines, source and date', () => {
    const texts = richTexts(NEWS_ITEM);
    assert.includes(texts, "TODAY'S BUSINESS NEWS");
    assert.includes(texts, 'Fed holds rates steady, signals one more cut');
    NEWS_SUMMARY.forEach((line) => assert.includes(texts, line));
    assert.includes(texts, '출처 · 매일경제 · 2026-11-21');

    const order = ["TODAY'S BUSINESS NEWS", 'Fed holds rates steady, signals one more cut', NEWS_SUMMARY[0], '출처 · 매일경제 · 2026-11-21'];
    const positions = order.map((text) => texts.indexOf(text));
    assert.ok(positions.every((index) => index > -1), 'news parts exist: ' + positions.join(','));
    assert.ok(positions[0] < positions[1] && positions[1] < positions[2] && positions[2] < positions[3], 'news parts in order');
  });

  test('then five keyword cards, each with its meaning, usage and two drills', () => {
    const texts = richTexts(NEWS_ITEM);
    NEWS_KEYWORDS.forEach((word, index) => {
      assert.includes(texts, 'KEYWORD ' + (index + 1) + ' · ' + word.en);
      assert.includes(texts, '뜻 · ' + word.ko);
      assert.includes(texts, '뉴스 속 쓰임 · ' + word.usageKo);
      word.drills.forEach((drill, drillIndex) => {
        assert.includes(texts, '패턴 드릴 ' + (drillIndex + 1) + '\n' + drill.en + '\n' + drill.ko + '\n패턴 · ' + drill.highlight);
      });
    });
  });

  test('the keyword cards come after the briefing, in order', () => {
    const texts = richTexts(NEWS_ITEM);
    const newsIndex = texts.indexOf("TODAY'S BUSINESS NEWS");
    for (let index = 0; index < NEWS_KEYWORDS.length; index += 1) {
      const at = texts.indexOf('KEYWORD ' + (index + 1) + ' · ' + NEWS_KEYWORDS[index].en);
      assert.ok(at > newsIndex, 'KEYWORD ' + (index + 1) + ' after the news');
      if (index > 0) {
        const previous = texts.indexOf('KEYWORD ' + index + ' · ' + NEWS_KEYWORDS[index - 1].en);
        assert.ok(at > previous, 'KEYWORD ' + (index + 1) + ' follows KEYWORD ' + index);
      }
    }
  });

  test('does not draw the five step headings or an AAA step for a news card', () => {
    const texts = richTexts(NEWS_ITEM).join('|');
    assert.excludes(texts, 'STEP 1 · KEY WORDS');
    assert.excludes(texts, 'ENGLISH WORD ORDER');
    assert.excludes(texts, 'AAA IN ACTION');
    assert.excludes(texts, 'MESSAGE HOUSE');
  });

  test('contentHtml mirrors the news card with its own classes', () => {
    const html = buildDailyTalkCmsData_(NEWS_ITEM).contentHtml;
    assert.includes(html, "<h3 class=\"dt-step-title\">TODAY'S BUSINESS NEWS</h3>");
    assert.includes(html, '<p class="dt-news-headline">Fed holds rates steady, signals one more cut</p>');
    assert.includes(html, '<p class="dt-news-line">' + NEWS_SUMMARY[0] + '</p>');
    assert.includes(html, '<p class="dt-news-source">출처 · 매일경제 · 2026-11-21</p>');
    assert.includes(html, '<h3 class="dt-step-title">KEYWORD 1 · hold rates steady</h3>');
    assert.includes(html, '<p class="dt-kw-ko">뜻 · 금리를 동결하다</p>');
    assert.includes(html, '<p class="dt-drill">패턴 드릴 1<br>The Fed held rates steady at its November meeting.<br>연준은 11월 회의에서 금리를 동결했습니다.<br>패턴 · held rates steady</p>');
    assert.equal((html.match(/class="dt-drill"/g) || []).length, 10);
    assert.equal((html.match(/class="dt-step-title">KEYWORD /g) || []).length, 5);
  });

  test('the CMS payload carries the five keywords, the headline and the title prefix', () => {
    const data = buildDailyTalkCmsData_(NEWS_ITEM, { slug: 'business-talk-2026-11-21-rates-on-hold' });
    assert.equal(data.title, '[Business Talk] 금리 동결');
    assert.equal(data.modelAnswerEn, NEWS_ITEM.modelEn);
    assert.equal(data.modelAnswerKo, NEWS_SUMMARY.join('\n'));
    assert.equal(data.yourTurnEn, NEWS_ITEM.yourTurnEn);
    assert.equal(data.slug, 'business-talk-2026-11-21-rates-on-hold');
    assert.equal(data.magazineUrl, 'https://www.ryanmembers.com/rm-magazine/business-talk-2026-11-21-rates-on-hold');
    const chunks = JSON.parse(data.chunksJson);
    assert.equal(chunks.length, 5);
    assert.deepEqual(chunks[0], { en: 'hold rates steady', ko: '금리를 동결하다' });
    assert.equal(data.generatedByAi, true);
    assert.includes(data.kakaoText, '금리 동결');
    assert.includes(data.kakaoText, data.magazineUrl);
  });

  test('the slug follows the CONTENT_ID and the send date', () => {
    assert.equal(buildDailyTalkCmsSlug_(NEWS_ITEM), 'business-talk-2026-11-21-rates-on-hold');
  });

  test('a news row whose STRUCTURE_JSON is unreadable still publishes readable text', () => {
    // The queue is the source of truth; if that cell were emptied by hand the
    // article falls back to the older chunk list instead of inventing a card.
    const bare = Object.assign({}, NEWS_ITEM, { structureJson: '' });
    const texts = richTexts(bare);
    assert.includes(texts, 'hold rates steady');
    assert.excludes(texts.join('|'), 'STEP 5 · AAA IN ACTION');
  });
});

// --- the older four-step body ---------------------------------------------

describe('Daily Talk CMS body — rows generated before 2026-11-20', () => {
  test('still renders the four old steps', () => {
    const texts = richTexts(LEGACY_ITEM);
    ['STEP 1 · KEY CHUNKS', 'STEP 2 · WORD ORDER', 'STEP 3 · AAA', 'STEP 4 · MODEL & YOUR TURN']
      .forEach((title) => assert.includes(texts, title));
    assert.includes(texts, '① 한국어 생각 — 오늘 아침은 / 정말 / 춥다');
    assert.includes(texts, '② 영어식 어순 — 오늘 아침은 / 춥다 / 정말');
    assert.includes(texts, 'Answer — 한 문장으로 먼저 답하기');
    assert.includes(texts, '내 말로 바꿔 말하기');
    assert.includes(texts, '오늘의 미션\nTry saying, It\'s freezing this morning, to a neighbor.\n오늘 이웃에게 오늘 아침 정말 춥네요라고 말해 보세요.');
    assert.excludes(texts.join('|'), 'STEP 5');
  });

  test('a queue row without step data still publishes what it has', () => {
    const bare = Object.assign({}, LEGACY_ITEM, { wordOrderJson: '', structureJson: '', substitutionsJson: '' });
    const texts = richTexts(bare);
    assert.includes(texts, 'STEP 1 · KEY CHUNKS');
    assert.includes(texts, 'STEP 4 · MODEL & YOUR TURN');
    assert.excludes(texts.join('|'), 'STEP 2 · WORD ORDER');
    assert.excludes(texts.join('|'), 'STEP 3 ·');
  });

  test('a message-house row keeps its four stages', () => {
    const messageHouse = Object.assign({}, LEGACY_ITEM, {
      track: 'BUSINESS',
      contentId: 'BUSINESS-20261119-updating-the-team',
      structureJson: JSON.stringify({
        type: 'MESSAGE_HOUSE',
        steps: [
          { label: 'Conclusion', en: 'We need one more day.', ko: '하루가 더 필요합니다.' },
          { label: 'Reason', en: 'The final check found two bugs.', ko: '마지막 점검에서 오류 두 개를 찾았습니다.' },
          { label: 'Detail', en: 'Both are in the payment screen.', ko: '둘 다 결제 화면에 있습니다.' },
          { label: 'Suggestion', en: 'Could we move the launch to Friday?', ko: '출시를 금요일로 옮겨도 될까요?' }
        ]
      })
    });
    const texts = richTexts(messageHouse);
    assert.includes(texts, 'STEP 3 · MESSAGE HOUSE');
    assert.includes(texts, 'Conclusion — 핵심 결론부터 말하기');
    assert.includes(texts, 'Suggestion — 다음 행동 제안하기');
    assert.excludes(texts.join('|'), 'STEP 3 · AAA');
  });
});

// --- slug ------------------------------------------------------------------

describe('Daily Talk CMS slug', () => {
  test('derives {track}-{date}-{topic} from a generated CONTENT_ID', () => {
    assert.equal(buildDailyTalkCmsSlug_(ITEM), 'small-talk-2026-11-20-warm-coffee-morning');
    assert.equal(buildDailyTalkCmsSlug_(BUSINESS_ITEM), 'business-talk-2026-11-20-one-more-day');
  });

  test('matches the shape of the slugs already in the collection', () => {
    const slug = buildDailyTalkCmsSlug_({
      contentId: 'SMALL_TALK-20260724-surf-fashion',
      track: 'SMALL_TALK'
    });
    assert.equal(slug, 'small-talk-2026-07-24-surf-fashion');
  });

  test('falls back to the topic, then to a constant, and stays URL safe', () => {
    assert.equal(buildDailyTalkCmsSlug_({ track: 'BUSINESS', dateKey: '2026-11-19', topicEn: 'Updating the team!' }), 'business-talk-2026-11-19-updating-the-team');
    assert.equal(buildDailyTalkCmsSlug_({ contentId: 'X', dateKey: '2026-11-19' }), 'small-talk-2026-11-19-x');
    assert.equal(buildDailyTalkCmsSlug_({ dateKey: '2026-11-19' }), 'small-talk-2026-11-19-daily-talk');
    const koreanOnly = buildDailyTalkCmsSlug_({ contentId: 'SMALL_TALK-20261119-점심', topicEn: '점심 약속', dateKey: '2026-11-19' });
    assert.equal(koreanOnly, 'small-talk-2026-11-19-daily-talk');
    assert.match(koreanOnly, /^[a-z0-9-]+$/);
  });

  test('a slug stored on the row is used as is', () => {
    assert.equal(buildDailyTalkCmsSlug_({ slug: 'small-talk-2026-08-10-test-small-talk-sample' }), 'small-talk-2026-08-10-test-small-talk-sample');
  });
});

// --- publication ------------------------------------------------------------

describe('publishDailyTalkToWix_ (CMS)', () => {
  const settings = {
    WIX_PUBLICATION_MODE: 'CMS_MAGAZINE',
    WIX_SITE_ID: '77af5a69-40e6-48a1-a727-03aee59a6da4',
    WIX_CMS_COLLECTION_ID: 'RyanDailyTalkContent',
    WIX_MAGAZINE_BASE_URL: 'https://www.ryanmembers.com/rm-magazine'
  };

  test('mode defaults to CMS even when 설정 has no WIX_PUBLICATION_MODE', () => {
    assert.equal(resolveWixPublicationMode_({}), 'CMS_MAGAZINE');
    assert.equal(resolveWixPublicationMode_({ WIX_PUBLICATION_MODE: 'blog' }), 'BLOG');
    assert.equal(resolveWixPublicationMode_({ WIX_PUBLICATION_MODE: 'CMS_MAGAZINE' }), 'CMS_MAGAZINE');
  });

  test('inserts a new item and returns the magazine URL and CMS id', () => {
    const urlFetch = fakeUrlFetch([
      [200, { dataItems: [] }],
      [200, { dataItem: { id: 'cms-item-1', data: { slug: 'small-talk-2026-11-20-warm-coffee-morning' } } }]
    ]);
    const result = withServiceStubs({
      PropertiesService: fakeProperties({ WIX_API_KEY: FAKE_KEY }),
      UrlFetchApp: urlFetch
    }, () => publishDailyTalkToWix_(ITEM, settings));

    assert.equal(result.postId, 'cms-item-1');
    assert.equal(result.url, 'https://www.ryanmembers.com/rm-magazine/small-talk-2026-11-20-warm-coffee-morning');
    assert.equal(result.publishedMode, 'CMS_MAGAZINE');
    assert.ok(result.publishedAt instanceof Date);

    assert.equal(urlFetch.calls.length, 2);
    const [query, insert] = urlFetch.calls;
    assert.equal(query.options.method, 'post');
    assert.includes(query.url, 'https://www.wixapis.com/wix-data/v2/items/query');
    assert.equal(insert.url, 'https://www.wixapis.com/wix-data/v2/items');
    assert.equal(insert.options.headers.Authorization, FAKE_KEY);
    assert.equal(insert.options.headers['wix-site-id'], settings.WIX_SITE_ID);
    assert.equal(insert.options.contentType, 'application/json');

    const body = parseBody(insert);
    assert.equal(body.dataCollectionId, 'RyanDailyTalkContent');
    assert.equal(body.dataItem.data.slug, 'small-talk-2026-11-20-warm-coffee-morning');
    assert.equal(body.dataItem.data.status, 'PUBLISHED');
    assert.ok(body.dataItem.data.contentRich.nodes.length > 10);
  });

  test('queries by slug before writing, so a rerun never duplicates the item', () => {
    const urlFetch = fakeUrlFetch([
      [200, { dataItems: [{ id: 'existing-1', data: { slug: 'small-talk-2026-11-20-warm-coffee-morning' } }] }],
      [200, { dataItem: { id: 'existing-1', data: { slug: 'small-talk-2026-11-20-warm-coffee-morning' } } }]
    ]);
    const result = withServiceStubs({
      PropertiesService: fakeProperties({ WIX_API_KEY: FAKE_KEY }),
      UrlFetchApp: urlFetch
    }, () => publishDailyTalkToWix_(ITEM, settings));

    assert.equal(result.postId, 'existing-1');
    assert.equal(urlFetch.calls.length, 2);
    const queryBody = parseBody(urlFetch.calls[0]);
    assert.deepEqual(queryBody.query.filter, { slug: 'small-talk-2026-11-20-warm-coffee-morning' });
    assert.equal(queryBody.query.paging.limit, 1);

    const patch = urlFetch.calls[1];
    assert.equal(patch.options.method, 'patch');
    assert.includes(patch.url, '/items/existing-1');
    const patchBody = parseBody(patch);
    assert.equal(patchBody.patch.dataItemId, 'existing-1');
    const fields = patchBody.patch.fieldModifications.map((field) => field.fieldPath);
    assert.includes(fields, 'topicEn');
    assert.includes(fields, 'contentRich');
    assert.includes(fields, 'kakaoText');
    patchBody.patch.fieldModifications.forEach((field) => {
      assert.equal(field.action, 'SET_FIELD');
    });
  });

  test('a Wix error surfaces with status and body but never the API key', () => {
    const urlFetch = fakeUrlFetch([
      [200, { dataItems: [] }],
      [401, { message: 'UNAUTHENTICATED: ' + FAKE_KEY + ' is not valid' }]
    ]);
    let error = null;
    try {
      withServiceStubs({
        PropertiesService: fakeProperties({ WIX_API_KEY: FAKE_KEY }),
        UrlFetchApp: urlFetch
      }, () => publishDailyTalkToWix_(ITEM, settings));
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, 'expected the publish to fail');
    assert.includes(error.message, '실패 (401)');
    assert.excludes(error.message, FAKE_KEY, 'the API key must not appear in the error');
  });

  test('a 200 answer without an item id is treated as a failure', () => {
    const urlFetch = fakeUrlFetch([
      [200, { dataItems: [] }],
      [200, { dataItem: { data: { slug: 'small-talk-2026-11-20-warm-coffee-morning' } } }]
    ]);
    let error = null;
    try {
      withServiceStubs({
        PropertiesService: fakeProperties({ WIX_API_KEY: FAKE_KEY }),
        UrlFetchApp: urlFetch
      }, () => publishDailyTalkToWix_(ITEM, settings));
    } catch (caught) {
      error = caught;
    }
    assert.ok(error && /item id/.test(error.message), 'expected a missing-id error');
  });

  test('a wrong slug in the response is caught before the queue records a URL', () => {
    const urlFetch = fakeUrlFetch([
      [200, { dataItems: [] }],
      [200, { dataItem: { id: 'cms-item-2', data: { slug: 'something-else' } } }]
    ]);
    let error = null;
    try {
      withServiceStubs({
        PropertiesService: fakeProperties({ WIX_API_KEY: FAKE_KEY }),
        UrlFetchApp: urlFetch
      }, () => publishDailyTalkToWix_(ITEM, settings));
    } catch (caught) {
      error = caught;
    }
    assert.ok(error && /슬러그/.test(error.message), 'expected a slug mismatch error');
  });

  test('a missing WIX_API_KEY fails before any Wix call', () => {
    const urlFetch = fakeUrlFetch([[200, {}]]);
    let error = null;
    try {
      withServiceStubs({
        PropertiesService: fakeProperties({}),
        UrlFetchApp: urlFetch
      }, () => publishDailyTalkToWix_(ITEM, settings));
    } catch (caught) {
      error = caught;
    }
    assert.ok(error && /WIX_API_KEY/.test(error.message));
    assert.equal(urlFetch.calls.length, 0);
  });

  test('WIX_PUBLICATION_MODE=BLOG keeps the old Blog API path', () => {
    const urlFetch = fakeUrlFetch([[200, { draftPost: { id: 'post-1', url: { base: 'https://www.ryanmembers.com', path: '/post/daily-talk' } } }]]);
    const result = withServiceStubs({
      PropertiesService: fakeProperties({ WIX_API_KEY: FAKE_KEY }),
      UrlFetchApp: urlFetch
    }, () => publishDailyTalkToWix_(ITEM, Object.assign({}, settings, { WIX_PUBLICATION_MODE: 'BLOG' })));
    assert.includes(urlFetch.calls[0].url, '/blog/v3/draft-posts');
    assert.equal(result.url, 'https://www.ryanmembers.com/post/daily-talk');
  });
});

// --- queue write-back -------------------------------------------------------

describe('publish result in 콘텐츠대기열', () => {
  test('writes WIX_CONTENT_URL, WIX_POST_ID, WIX_PUBLISHED_AT and 카카오본문', () => {
    const sheet = stubSheet();
    const headerUnit = { WIX_CONTENT_URL: 20, WIX_POST_ID: 21, WIX_PUBLISHED_AT: 22, 카카오본문: 16 };
    const publishedAt = new Date('2026-11-20T10:00:00Z');
    writeQueuePublishingResult_(sheet, headerUnit, 5, {
      url: 'https://www.ryanmembers.com/rm-magazine/small-talk-2026-11-20-warm-coffee-morning',
      postId: 'cms-item-1',
      publishedAt: publishedAt,
      kakaoText: '본문'
    });
    assert.equal(sheet.cells['5:20'], 'https://www.ryanmembers.com/rm-magazine/small-talk-2026-11-20-warm-coffee-morning');
    assert.equal(sheet.cells['5:21'], 'cms-item-1');
    assert.equal(sheet.cells['5:22'], publishedAt);
    assert.equal(sheet.cells['5:16'], '본문');
  });

  test('keeps a usable body when the publisher has no kakaoText', () => {
    const sheet = stubSheet();
    writeQueuePublishingResult_(sheet, { 카카오본문: 16 }, 2, {
      url: 'https://www.ryanmembers.com/rm-magazine/x',
      postId: 'id',
      publishedAt: new Date()
    });
    assert.includes(sheet.cells['2:16'], 'https://www.ryanmembers.com/rm-magazine/x');
  });

  test('the published magazine URL passes the send-time URL guard', () => {
    assert.equal(isValidWixPostUrl('https://www.ryanmembers.com/rm-magazine/small-talk-2026-11-20-warm-coffee-morning'), true);
    assert.equal(isValidWixPostUrl('https://www.ryanmembers.com/rm-magazine'), false);
    assert.equal(isValidWixPostUrl('https://www.ryanmembers.com/rm-magazine/'), false);
  });
});
