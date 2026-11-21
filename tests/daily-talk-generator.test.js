/**
 * Daily Talk content generator — pure-layer tests.
 * The generator is exercised through the exact .gs source that goes to Apps
 * Script; no network, Sheets or OpenAI call is made here.
 *
 * The lesson is the academy's five steps:
 *   1 words (3) -> 2 Korean sentences (3) -> 3 the same sentences in English
 *   word order -> 4 the same sentences in English -> 5 the structure the track
 *   uses: AAA (Answer/Add/Ask) for small talk, Message House
 *   (Conclusion/Reason/Detail/Suggestion) for business.
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
  messageHouse: {
    pick: 1,
    conclusion: { en: 'We need one more day for the launch.', ko: '출시에 하루가 더 필요합니다.' },
    reason: { en: 'The final check found two bugs.', ko: '마지막 점검에서 오류 두 개가 나왔습니다.' },
    detail: { en: 'Both are on the payment screen.', ko: '둘 다 결제 화면에 있습니다.' },
    suggestion: { en: 'Could we push the launch to Friday?', ko: '출시를 금요일로 미룰 수 있을까요?' }
  }
};

/** The business card's step 5: a Top-Down Message House, 3 or 4 sentences. */
const BUSINESS_MESSAGE_HOUSE = {
  pick: 1,
  conclusion: { en: 'We need one more day for the launch.', ko: '출시에 하루가 더 필요합니다.' },
  reason: { en: 'The final check found two bugs.', ko: '마지막 점검에서 오류 두 개가 나왔습니다.' },
  detail: { en: 'Both are on the payment screen.', ko: '둘 다 결제 화면에 있습니다.' },
  suggestion: { en: 'Could we push the launch to Friday?', ko: '출시를 금요일로 미룰 수 있을까요?' }
};
const BUSINESS_SAMPLE_AA = Object.assign({}, BUSINESS_SAMPLE, {
  messageHouse: undefined,
  aaa: {
    pick: 1,
    answer: { en: 'We need one more day for the launch.', ko: '출시에 하루가 더 필요합니다.' },
    add: { en: 'The final check found two bugs.', ko: '마지막 점검에서 오류 두 개가 나왔습니다.' },
    ask: { en: 'Does Friday still work for you?', ko: '금요일도 괜찮으실까요?' }
  }
});

/** The same business card with the Suggestion left out (a 3-sentence message). */
const BUSINESS_MESSAGE_HOUSE_SHORT = Object.assign({}, BUSINESS_MESSAGE_HOUSE, {
  suggestion: { en: '', ko: '' }
});

/** The real news list the BUSINESS prompt is handed (numbered candidates). */
const NEWS_CANDIDATES = [
  {
    index: 1,
    title: '연준, 기준금리 3.75%로 동결…연내 추가 인하엔 신중',
    publisher: '매일경제',
    dateKey: '2026-11-21',
    url: 'https://www.mk.co.kr/news/economy/1',
    summary: '미 연방준비제도가 기준금리를 3.75%로 동결하고 물가 흐름을 더 지켜보겠다고 밝혔다.'
  },
  {
    index: 2,
    title: '원·달러 환율 1,380원대 마감…수출 기업 결제 부담',
    publisher: '연합뉴스',
    dateKey: '2026-11-21',
    url: 'https://www.yna.co.kr/view/2',
    summary: '원·달러 환율이 1,380원대에서 마감하며 수출 기업의 결제 부담이 커졌다.'
  }
];

/** A BUSINESS card: today's news + five keywords with two drills each. */
const NEWS_SAMPLE_KEYWORDS = [
  {
    en: 'hold rates steady',
    ko: '금리를 동결하다',
    usageKo: '연준이 기준금리를 그대로 두었다는 뜻으로 쓰였습니다.',
    drills: [
      { en: 'The Fed held rates steady at its November meeting.', ko: '연준은 11월 회의에서 금리를 동결했습니다.', highlight: 'held rates steady' },
      { en: "We're holding prices steady through the quarter.", ko: '우리는 이번 분기 동안 가격을 동결하고 있습니다.', highlight: 'holding prices steady' }
    ]
  },
  {
    en: 'signal a cut',
    ko: '인하 신호를 보내다',
    usageKo: '다음 회의에서 금리를 내릴 수 있다는 신호를 줬습니다.',
    drills: [
      { en: 'The Fed signaled a cut in December.', ko: '연준은 12월 인하 신호를 보냈습니다.', highlight: 'signaled a cut' },
      { en: 'The report signals a cut in our budget.', ko: '그 보고서는 예산 축소 신호를 보여 줍니다.', highlight: 'signals a cut' }
    ]
  },
  {
    en: 'inflation report',
    ko: '물가 보고서',
    usageKo: '금리 결정 전에 나온 물가 보고서가 근거로 언급되었습니다.',
    drills: [
      { en: 'The inflation report came out before the meeting.', ko: '물가 보고서는 회의 전에 나왔습니다.', highlight: 'inflation report' },
      { en: 'I read the inflation report on my commute.', ko: '출근길에 물가 보고서를 읽었습니다.', highlight: 'inflation report' }
    ]
  },
  {
    en: 'policy meeting',
    ko: '정책 회의',
    usageKo: '연준의 정책 회의 결과가 시장의 관심을 모았습니다.',
    drills: [
      { en: 'The policy meeting ended at two oclock.', ko: '정책 회의는 두 시에 끝났습니다.', highlight: 'policy meeting' },
      { en: 'Our policy meeting is on Thursday.', ko: '우리 정책 회의는 목요일에 있습니다.', highlight: 'policy meeting' }
    ]
  },
  {
    en: 'rate cut',
    ko: '금리 인하',
    usageKo: '연내 금리 인하 가능성이 낮아졌다는 해석이 나왔습니다.',
    drills: [
      { en: 'Investors expect one more rate cut this year.', ko: '투자자들은 올해 금리 인하가 한 번 더 있을 것으로 봅니다.', highlight: 'rate cut' },
      { en: 'A rate cut would help our loan.', ko: '금리 인하면 우리 대출에 도움이 됩니다.', highlight: 'rate cut' }
    ]
  }
];

const NEWS_SAMPLE = {
  topicEn: 'Rates On Hold',
  topicKo: '금리 동결',
  news: {
    headlineEn: 'Fed holds rates steady, signals one more cut',
    summaryKo: [
      '미 연방준비제도가 기준금리를 3.75%로 동결했습니다.',
      '물가가 목표치에 가까워졌지만 인하 시점은 더 지켜보겠다고 밝혔습니다.',
      '한국은행도 당분간 금리를 유지할 가능성이 커졌습니다.'
    ],
    sourceIndexes: [1]
  },
  keywords: NEWS_SAMPLE_KEYWORDS
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
    assert.includes(business.system, 'office workers');
    assert.includes(business.user, '2026-11-20');
    assert.equal(business.schemaName, 'ryan_daily_talk_business_news');
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

  test('small talk keeps the five steps, business turns into the news card', () => {
    const small = buildContentPrompt('SMALL_TALK', {});
    assert.equal(small.structureType, 'AAA');
    assert.includes(small.system, 'This card is SMALL TALK');
    assert.includes(small.system, 'Step 5 AAA');

    const business = buildContentPrompt('BUSINESS', {});
    assert.equal(business.structureType, 'NEWS_DRILLS');
    assert.includes(business.system, 'Ryan Daily Talk BUSINESS');
    assert.includes(business.system, 'five English keywords');
    assert.includes(business.system, 'two pattern drills for each keyword');
    assert.excludes(business.system, 'Step 5 AAA');
  });

  test('a business prompt hands over today\'s news and asks for 5 keywords with 2 drills each', () => {
    const business = buildContentPrompt('BUSINESS', { news: NEWS_CANDIDATES });
    assert.includes(business.user, '[1] 2026-11-21 · 매일경제');
    assert.includes(business.user, NEWS_CANDIDATES[0].title);
    assert.includes(business.user, '[2] 2026-11-21 · 연합뉴스');
    ['news.headlineEn', 'news.summaryKo', 'news.sourceIndexes', 'keywords', 'usageKo', 'drills', 'highlight']
      .forEach((field) => assert.includes(business.user, field));
    assert.includes(business.user, 'exactly 5 items');
    assert.includes(business.user, 'exactly 2 practice sentences');
    assert.excludes(business.user, 'messageHouse');
  });

  test('the business prompt forbids politics, forecasts and invented numbers', () => {
    const business = buildContentPrompt('BUSINESS', {});
    assert.includes(business.system, 'Never choose politics');
    assert.includes(business.system, 'Never add an opinion');
    assert.includes(business.user, 'no political opinion, no stock tip');
    assert.includes(business.user, 'Facts from the news list only');
  });

  test('asks for the steps to point at the same three sentences', () => {
    const prompt = buildContentPrompt('SMALL_TALK', {});
    assert.includes(prompt.system, 'must all point at the same three sentences');
    assert.includes(prompt.user, 'At least two of the three words must visibly appear');
    assert.includes(prompt.user, 'The answer must be built on the picked sentence');
  });

  test('ties the Message House back to the picked sentence and the words', () => {
    const prompt = buildContentPrompt('SMALL_TALK', {});
    assert.includes(prompt.user, 'The answer must be built on the picked sentence');
    assert.includes(prompt.user, 'At least two of the three words must visibly appear');
  });

  test('frames small talk as a real first meeting, not a solo daily-life scene', () => {
    const prompt = buildContentPrompt('SMALL_TALK', {});
    assert.includes(prompt.system, 'first-meeting social English');
    assert.includes(prompt.system, 'The scene of every SMALL TALK card is a first meeting');
    assert.includes(prompt.user, 'The scene: one real first meeting');
    assert.includes(prompt.user, 'no receiving a parcel or a delivery at home');
    // The vague old brief (greetings / neighbours / delivery) is gone.
    assert.excludes(RM_DAILY_TALK_TRACK_BRIEFS.SMALL_TALK, 'neighbours');
    assert.excludes(RM_DAILY_TALK_TRACK_BRIEFS.SMALL_TALK, 'greetings');
    assert.includes(RM_DAILY_TALK_TRACK_BRIEFS.SMALL_TALK, 'first-meeting social English');
  });

  test('lists the sixteen 영어입담비법서 first-meeting topics and asks for rotation', () => {
    assert.equal(RM_DAILY_TALK_SOCIAL_TOPICS.length, 16);
    const prompt = buildContentPrompt('SMALL_TALK', {});
    RM_DAILY_TALK_SOCIAL_TOPICS.forEach((topic) => assert.includes(prompt.user, topic));
    assert.includes(prompt.user, '01 날씨·계절');
    assert.includes(prompt.user, '16 근황·주말 계획');
    assert.includes(prompt.user, 'rotate through them from day to day');
    assert.includes(prompt.user, 'do not stay on the same topic two days running');
    // BUSINESS keeps its own prompt: no topic list leaking into the news card.
    assert.excludes(buildContentPrompt('BUSINESS', {}).user, '16 근황·주말 계획');
  });

  test('asks every sentence to be spoken to the person, with one question to hand the turn over', () => {
    const prompt = buildContentPrompt('SMALL_TALK', {});
    assert.includes(prompt.system, 'At least one of the three is a question the learner asks the other person');
    assert.includes(prompt.user, 'At least one of the three sentences is a question the learner asks the other person');
    assert.includes(prompt.user, 'The three sentences follow one conversation in order');
    assert.includes(prompt.user, 'no talking to oneself');
  });

  test('keeps the three sentences from repeating one another', () => {
    const prompt = buildContentPrompt('SMALL_TALK', {});
    assert.includes(prompt.user, 'The three sentences each do a different job and never repeat each other');
    assert.includes(prompt.user, 'one answers about the learner, one adds a detail or a short story');
  });

  test('step 5 AAA answers, adds and asks back inside the same first meeting', () => {
    const prompt = buildContentPrompt('SMALL_TALK', {});
    assert.includes(prompt.system, 'Answer says the picked sentence as the learner');
    assert.includes(prompt.system, 'gives the turn back to them');
    assert.includes(prompt.user, '"answer" = Answer: the picked sentence said as the learner');
    assert.includes(prompt.user, '"add" = Add: one more sentence with the reason');
    assert.includes(prompt.user, '"ask" = Ask: one natural question back to the other person');
    assert.includes(prompt.user, 'belong to that same scene');
    assert.equal(prompt.structureType, 'AAA');
  });

  test('keeps a first meeting from turning into an interview', () => {
    const prompt = buildContentPrompt('SMALL_TALK', {});
    assert.includes(prompt.user, 'Nothing too personal for a first meeting');
    assert.includes(prompt.user, 'no questions about age, salary, religion, politics, health or relationship status');
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

  test('a business schema requires the Message House instead of AAA', () => {
    const schema = buildDailyTalkContentSchema('MESSAGE_HOUSE');
    assert.deepEqual(schema.required,
      ['topicEn', 'topicKo', 'snackEn', 'snackKo', 'words', 'sentences', 'messageHouse']);
    assert.equal(schema.properties.aaa, undefined);
    assert.deepEqual(schema.properties.messageHouse.required,
      ['pick', 'conclusion', 'reason', 'detail', 'suggestion']);
    assert.equal(schema.properties.messageHouse.properties.pick.maximum, 3);
    assert.deepEqual(schema.properties.messageHouse.properties.reason.required, ['en', 'ko']);
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

  test('a business payload carries a Message House, and the type comes from the payload', () => {
    const content = normalizeGeneratedContent(BUSINESS_SAMPLE, { track: 'BUSINESS' });
    assert.equal(content.structureType, 'MESSAGE_HOUSE');
    assert.equal(content.messageHouse.conclusion.en, 'We need one more day for the launch.');
    assert.equal(content.messageHouse.suggestion.ko, '출시를 금요일로 미룰 수 있을까요?');

    const small = normalizeGeneratedContent(SAMPLE, { track: 'SMALL_TALK' });
    assert.equal(small.structureType, 'AAA');
    assert.equal(small.messageHouse.conclusion.en, '');
  });

  test('a business payload in the older AAA shape still normalizes as AAA', () => {
    const content = normalizeGeneratedContent(BUSINESS_SAMPLE_AA, { track: 'BUSINESS' });
    assert.equal(content.structureType, 'AAA');
    assert.equal(content.aaa.ask.en, 'Does Friday still work for you?');
  });
});

describe('validateGeneratedContent', () => {
  test('accepts a complete five-step item', () => {
    const result = validateGeneratedContent(normalizeGeneratedContent(SAMPLE, { track: 'SMALL_TALK', level: 'BASIC' }));
    assert.deepEqual(result, { ok: true, errors: [] });
  });

  test('accepts the business track with a Message House', () => {
    const result = validateGeneratedContent(normalizeGeneratedContent(BUSINESS_SAMPLE, { track: 'BUSINESS' }));
    assert.deepEqual(result, { ok: true, errors: [] });
  });

  test('accepts a three-sentence Message House (no Suggestion)', () => {
    const content = normalizeGeneratedContent(Object.assign({}, BUSINESS_SAMPLE, {
      messageHouse: BUSINESS_MESSAGE_HOUSE_SHORT
    }), { track: 'BUSINESS' });
    assert.deepEqual(validateGeneratedContent(content), { ok: true, errors: [] });
    assert.deepEqual(dailyTalkStructureLabels(content.structureType),
      ['Conclusion', 'Reason', 'Detail', 'Suggestion']);
  });

  test('requires the Conclusion, Reason and Detail of a Message House', () => {
    const missingReason = normalizeGeneratedContent(Object.assign({}, BUSINESS_SAMPLE, {
      messageHouse: Object.assign({}, BUSINESS_MESSAGE_HOUSE, { reason: { en: '', ko: '' } })
    }), { track: 'BUSINESS' });
    assert.ok(validateGeneratedContent(missingReason).errors.some((error) => error.field === 'messageHouse.reason.en'));

    const englishDetail = normalizeGeneratedContent(Object.assign({}, BUSINESS_SAMPLE, {
      messageHouse: Object.assign({}, BUSINESS_MESSAGE_HOUSE, { detail: { en: '결제 화면', ko: '결제 화면' } })
    }), { track: 'BUSINESS' });
    assert.ok(validateGeneratedContent(englishDetail).errors.some((error) => error.field === 'messageHouse.detail.en'));
  });

  test('a half-filled Suggestion is an error, an empty one is not', () => {
    const half = normalizeGeneratedContent(Object.assign({}, BUSINESS_SAMPLE, {
      messageHouse: Object.assign({}, BUSINESS_MESSAGE_HOUSE, { suggestion: { en: 'Should we shift it?', ko: '' } })
    }), { track: 'BUSINESS' });
    assert.ok(validateGeneratedContent(half).errors.some((error) => error.field === 'messageHouse.suggestion.ko'));

    const empty = normalizeGeneratedContent(Object.assign({}, BUSINESS_SAMPLE, {
      messageHouse: BUSINESS_MESSAGE_HOUSE_SHORT
    }), { track: 'BUSINESS' });
    assert.deepEqual(validateGeneratedContent(empty), { ok: true, errors: [] });
  });

  test('rejects a business Message House with a bad pick or detached from the sentences', () => {
    const badPick = normalizeGeneratedContent(Object.assign({}, BUSINESS_SAMPLE, {
      messageHouse: Object.assign({}, BUSINESS_MESSAGE_HOUSE, { pick: 4 })
    }), { track: 'BUSINESS' });
    assert.ok(validateGeneratedContent(badPick).errors.some((error) => error.field === 'messageHouse.pick'));

    const detached = normalizeGeneratedContent(Object.assign({}, BUSINESS_SAMPLE, {
      messageHouse: {
        pick: 1,
        conclusion: { en: 'My sister lives in Canada.', ko: '제 여동생은 캐나다에 살아요.' },
        reason: { en: 'She moved there last year.', ko: '작년에 이사했어요.' },
        detail: { en: 'She likes the snow.', ko: '눈을 좋아해요.' },
        suggestion: { en: '', ko: '' }
      }
    }), { track: 'BUSINESS' });
    assert.ok(validateGeneratedContent(detached).errors.some((error) => error.field === 'messageHouse.conclusion'));
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

  test('a business card stores its Message House in STRUCTURE_JSON and MODEL_*', () => {
    const business = normalizeGeneratedContent(BUSINESS_SAMPLE, { track: 'BUSINESS', level: 'BASIC' });
    const row = buildQueueRowValues(headerMap, business, { contentId: 'BUSINESS-20261120-one-more-day' });
    const structure = JSON.parse(row[headerMap.STRUCTURE_JSON - 1]);
    assert.equal(structure.type, 'MESSAGE_HOUSE');
    assert.equal(structure.pick, 1);
    assert.deepEqual(structure.steps.map((step) => step.label),
      ['Conclusion', 'Reason', 'Detail', 'Suggestion']);
    assert.equal(structure.steps[0].en, BUSINESS_MESSAGE_HOUSE.conclusion.en);
    assert.equal(row[headerMap.MODEL_EN - 1].split('\n')[0],
      'Conclusion: ' + BUSINESS_MESSAGE_HOUSE.conclusion.en);
    assert.includes(row[headerMap.MODEL_KO - 1], 'Suggestion: ' + BUSINESS_MESSAGE_HOUSE.suggestion.ko);
    assert.equal(row[headerMap.YOUR_TURN_EN - 1], RM_DAILY_TALK_PRACTICE_CUES.MESSAGE_HOUSE.en);
    assert.equal(row[headerMap.YOUR_TURN_KO - 1], RM_DAILY_TALK_PRACTICE_CUES.MESSAGE_HOUSE.ko);
  });

  test('a three-sentence Message House stores only its three steps', () => {
    const business = normalizeGeneratedContent(Object.assign({}, BUSINESS_SAMPLE, {
      messageHouse: BUSINESS_MESSAGE_HOUSE_SHORT
    }), { track: 'BUSINESS' });
    const row = buildQueueRowValues(headerMap, business, { contentId: 'C2' });
    const structure = JSON.parse(row[headerMap.STRUCTURE_JSON - 1]);
    assert.equal(structure.steps.length, 3);
    assert.equal(row[headerMap.MODEL_EN - 1].split('\n').length, 3);
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
    assert.equal(dailyTalkStructureTypeFor('BUSINESS'), 'NEWS_DRILLS');
    assert.deepEqual(dailyTalkStructureLabels('MESSAGE_HOUSE'), ['Conclusion', 'Reason', 'Detail', 'Suggestion']);
    assert.deepEqual(dailyTalkStructureLabels('NEWS_DRILLS'), []);
  });
});

describe('parseNewsRssFeed', () => {
  const RSS = '<rss><channel>' +
    '<item>' +
    '<title>연준, 기준금리 동결 - 매일경제</title>' +
    '<link>https://news.google.com/rss/articles/1</link>' +
    '<pubDate>Fri, 21 Nov 2026 00:10:00 GMT</pubDate>' +
    '<source url="https://www.mk.co.kr">매일경제</source>' +
    '<description><![CDATA[<a href="x">연준</a>이 기준금리를 &amp; 동결했다.]]></description>' +
    '</item>' +
    '<item>' +
    '<title>원·달러 환율 1,380원대 마감</title>' +
    '<link>https://www.yna.co.kr/view/2</link>' +
    '<pubDate>Thu, 20 Nov 2026 22:05:00 GMT</pubDate>' +
    '<description>환율이 1,380원대에서 마감했다.</description>' +
    '</item>' +
    '</channel></rss>';

  test('reads the Google News item shape: publisher, title, date, link, summary', () => {
    const items = parseNewsRssFeed(RSS, { publisher: '연합뉴스' });
    assert.equal(items.length, 2);
    assert.equal(items[0].publisher, '매일경제');
    assert.equal(items[0].title, '연준, 기준금리 동결');
    assert.equal(items[0].url, 'https://news.google.com/rss/articles/1');
    assert.equal(items[0].dateKey, '2026-11-21');
    assert.equal(items[0].summary, '연준이 기준금리를 & 동결했다.');
  });

  test('falls back to the feed name and converts the date to Seoul time', () => {
    const items = parseNewsRssFeed(RSS, { publisher: '연합뉴스' });
    assert.equal(items[1].publisher, '연합뉴스');
    // 22:05 UTC on the 20th is 07:05 on the 21st in Seoul.
    assert.equal(items[1].dateKey, '2026-11-21');
  });

  test('ignores an item without a title', () => {
    assert.equal(parseNewsRssFeed('<rss><item><link>x</link></item></rss>', {}).length, 0);
    assert.equal(parseNewsRssFeed('', {}).length, 0);
  });
});

describe('selectNewsCandidates', () => {
  const base = { publisher: '매일경제', url: 'https://a', dateKey: '2026-11-21', summary: '' };
  const now = '2026-11-21T02:00:00Z';

  test('drops politics, sport and non-business stories', () => {
    const items = [
      Object.assign({}, base, { title: '국회 예산안 처리 놓고 여야 대립', publishedMs: Date.parse(now) }),
      Object.assign({}, base, { title: '프로야구 한국시리즈 7차전 열려', publishedMs: Date.parse(now) }),
      Object.assign({}, base, { title: '연준 기준금리 동결 결정', publishedMs: Date.parse(now) })
    ];
    const picked = selectNewsCandidates(items, { now });
    assert.equal(picked.length, 1);
    assert.equal(picked[0].title, '연준 기준금리 동결 결정');
  });

  test('keeps one copy of a story two feeds reported', () => {
    const items = [
      Object.assign({}, base, { title: '연준 기준금리 동결 결정', publishedMs: Date.parse(now) }),
      Object.assign({}, base, { title: '연준 기준금리 동결 결정!!', publisher: '연합뉴스', publishedMs: Date.parse(now) })
    ];
    assert.equal(selectNewsCandidates(items, { now }).length, 1);
  });

  test('sorts newest first, numbers the list and respects the limit', () => {
    const items = [
      Object.assign({}, base, { title: '어제 나온 수출 지표 개선', publishedMs: Date.parse('2026-11-20T03:00:00Z') }),
      Object.assign({}, base, { title: '오늘 나온 금리 동결 발표', publishedMs: Date.parse('2026-11-21T00:00:00Z') }),
      Object.assign({}, base, { title: '환율 1,380원대 마감 소식', publishedMs: Date.parse('2026-11-21T01:00:00Z') })
    ];
    const picked = selectNewsCandidates(items, { now, limit: 2 });
    assert.equal(picked.length, 2);
    assert.equal(picked[0].title, '환율 1,380원대 마감 소식');
    assert.equal(picked[0].index, 1);
    assert.equal(picked[1].index, 2);
  });

  test('leaves out a story older than the freshness window', () => {
    const items = [
      Object.assign({}, base, { title: '사흘 전 지난 소식 정리', publishedMs: Date.parse('2026-11-18T00:00:00Z') })
    ];
    assert.equal(selectNewsCandidates(items, { now, freshHours: 48 }).length, 0);
  });
});

describe('business news card', () => {
  test('the schema asks for the briefing and exactly five keywords with two drills', () => {
    const schema = buildDailyTalkContentSchema('NEWS_DRILLS');
    assert.deepEqual(schema.required, ['topicEn', 'topicKo', 'news', 'keywords']);
    assert.equal(schema.properties.keywords.minItems, 5);
    assert.equal(schema.properties.keywords.maxItems, 5);
    const keyword = schema.properties.keywords.items;
    assert.deepEqual(keyword.required, ['en', 'ko', 'usageKo', 'drills']);
    assert.equal(keyword.properties.drills.minItems, 2);
    assert.deepEqual(keyword.properties.drills.items.required, ['en', 'ko', 'highlight']);
    assert.equal(schema.properties.news.properties.summaryKo.minItems, 3);
    assert.equal(schema.properties.news.properties.summaryKo.maxItems, 4);
    assert.equal(schema.properties.news.properties.sourceIndexes.maxItems, 3);
    assert.equal(schema.properties.news.additionalProperties, false);
  });

  test('normalizes the payload and resolves the real publisher and date', () => {
    const content = normalizeGeneratedContent(NEWS_SAMPLE, { track: 'BUSINESS', level: 'basic', news: NEWS_CANDIDATES });
    assert.equal(content.structureType, 'NEWS_DRILLS');
    assert.equal(content.level, 'BASIC');
    assert.equal(content.topicEn, 'Rates On Hold');
    assert.equal(content.news.summaryKo.length, 3);
    assert.equal(content.news.sources.length, 1);
    assert.equal(content.news.sources[0].publisher, '매일경제');
    assert.equal(content.news.sources[0].date, '2026-11-21');
    assert.equal(content.news.sources[0].url, 'https://www.mk.co.kr/news/economy/1');
    assert.equal(content.keywords.length, 5);
    assert.equal(content.keywords[0].drills[1].highlight, 'holding prices steady');
  });

  test('an out-of-range sourceIndex leaves the card without a source', () => {
    const content = normalizeGeneratedContent(
      Object.assign({}, NEWS_SAMPLE, { news: Object.assign({}, NEWS_SAMPLE.news, { sourceIndexes: [9] }) }),
      { track: 'BUSINESS', news: NEWS_CANDIDATES }
    );
    assert.equal(content.news.sources.length, 0);
    const result = validateGeneratedContent(content);
    assert.ok(result.errors.some((error) => error.field === 'news.sources'));
  });

  test('accepts a complete card', () => {
    const content = normalizeGeneratedContent(NEWS_SAMPLE, { track: 'BUSINESS', news: NEWS_CANDIDATES });
    assert.deepEqual(validateGeneratedContent(content), { ok: true, errors: [] });
  });

  test('requires five keywords, two drills each and a highlighted pattern in the sentence', () => {
    const four = normalizeGeneratedContent(
      Object.assign({}, NEWS_SAMPLE, { keywords: NEWS_SAMPLE.keywords.slice(0, 4) }),
      { track: 'BUSINESS', news: NEWS_CANDIDATES }
    );
    assert.ok(validateGeneratedContent(four).errors.some((error) => error.field === 'keywords'));

    const oneDrill = normalizeGeneratedContent(Object.assign({}, NEWS_SAMPLE, {
      keywords: [Object.assign({}, NEWS_SAMPLE.keywords[0], { drills: NEWS_SAMPLE.keywords[0].drills.slice(0, 1) })].concat(NEWS_SAMPLE.keywords.slice(1))
    }), { track: 'BUSINESS', news: NEWS_CANDIDATES });
    assert.ok(validateGeneratedContent(oneDrill).errors.some((error) => error.field === 'keywords[0].drills'));

    const detached = normalizeGeneratedContent(Object.assign({}, NEWS_SAMPLE, {
      keywords: [Object.assign({}, NEWS_SAMPLE.keywords[0], {
        drills: [{ en: 'The Fed held rates steady.', ko: '연준이 금리를 동결했습니다.', highlight: 'cut rates' }, NEWS_SAMPLE.keywords[0].drills[1]]
      })].concat(NEWS_SAMPLE.keywords.slice(1))
    }), { track: 'BUSINESS', news: NEWS_CANDIDATES });
    assert.ok(validateGeneratedContent(detached).errors.some((error) => error.field === 'keywords[0].drills[0].highlight'));
  });

  test('rejects a summary that is too short, or a keyword written in Hangul', () => {
    const shortSummary = normalizeGeneratedContent(Object.assign({}, NEWS_SAMPLE, {
      news: Object.assign({}, NEWS_SAMPLE.news, { summaryKo: NEWS_SAMPLE.news.summaryKo.slice(0, 2) })
    }), { track: 'BUSINESS', news: NEWS_CANDIDATES });
    assert.ok(validateGeneratedContent(shortSummary).errors.some((error) => error.field === 'news.summaryKo'));

    const hangulKeyword = normalizeGeneratedContent(Object.assign({}, NEWS_SAMPLE, {
      keywords: [Object.assign({}, NEWS_SAMPLE.keywords[0], { en: '금리 동결' })].concat(NEWS_SAMPLE.keywords.slice(1))
    }), { track: 'BUSINESS', news: NEWS_CANDIDATES });
    assert.ok(validateGeneratedContent(hangulKeyword).errors.some((error) => error.field === 'keywords[0].en'));
  });

  test('rejects a repeated keyword and a Korean drill sentence', () => {
    const repeated = normalizeGeneratedContent(Object.assign({}, NEWS_SAMPLE, {
      keywords: [NEWS_SAMPLE.keywords[0], Object.assign({}, NEWS_SAMPLE.keywords[1], { en: 'hold rates steady' })].concat(NEWS_SAMPLE.keywords.slice(2))
    }), { track: 'BUSINESS', news: NEWS_CANDIDATES });
    assert.ok(validateGeneratedContent(repeated).errors.some((error) => error.field === 'keywords[1].en'));

    const koreanDrill = normalizeGeneratedContent(Object.assign({}, NEWS_SAMPLE, {
      keywords: [Object.assign({}, NEWS_SAMPLE.keywords[0], {
        drills: [Object.assign({}, NEWS_SAMPLE.keywords[0].drills[0], { en: '연준이 금리를 동결했다' }), NEWS_SAMPLE.keywords[0].drills[1]]
      })].concat(NEWS_SAMPLE.keywords.slice(1))
    }), { track: 'BUSINESS', news: NEWS_CANDIDATES });
    assert.ok(validateGeneratedContent(koreanDrill).errors.some((error) => error.field === 'keywords[0].drills[0].en'));
  });
});

describe('the news card in the queue', () => {
  const headerMap = {};
  RM_DAILY_TALK_GEN.QUEUE_HEADERS.forEach((header, index) => { headerMap[header] = index + 1; });
  headerMap.WORD_ORDER_JSON = 20;
  headerMap.STRUCTURE_JSON = 21;
  headerMap.SUBSTITUTIONS_JSON = 22;
  const content = normalizeGeneratedContent(NEWS_SAMPLE, { track: 'BUSINESS', level: 'BASIC', news: NEWS_CANDIDATES });
  const row = buildQueueRowValues(headerMap, content, {
    contentId: 'BUSINESS-20261121-rates-on-hold',
    sendDate: '2026-11-21',
    status: 'TEST',
    sources: 'OPENAI:gpt-5.5\nhttps://www.mk.co.kr/news/economy/1'
  });

  test('CHUNKS_JSON holds the five keywords with their Korean usage', () => {
    const words = JSON.parse(row[headerMap.CHUNKS_JSON - 1]);
    assert.equal(words.length, 5);
    assert.equal(words[0].en, 'hold rates steady');
    assert.equal(words[0].ko, '금리를 동결하다');
    assert.includes(words[0].usageKo, '연준');
  });

  test('STRUCTURE_JSON holds the briefing, its real sources and the keywords', () => {
    const structure = JSON.parse(row[headerMap.STRUCTURE_JSON - 1]);
    assert.equal(structure.type, 'NEWS_DRILLS');
    assert.equal(structure.news.headlineEn, NEWS_SAMPLE.news.headlineEn);
    assert.equal(structure.news.summaryKo.length, 3);
    assert.equal(structure.news.sources[0].publisher, '매일경제');
    assert.equal(structure.keywords.length, 5);
    assert.equal(structure.keywords[0].drills.length, 2);
    assert.equal(structure.keywords[0].drills[0].highlight, 'held rates steady');
  });

  test('WORD_ORDER_JSON stays empty and MODEL_* carries the headline and summary', () => {
    assert.equal(row[19], '');
    assert.equal(row[headerMap.MODEL_EN - 1], NEWS_SAMPLE.news.headlineEn);
    assert.equal(row[headerMap.MODEL_KO - 1], NEWS_SAMPLE.news.summaryKo.join('\n'));
    assert.equal(row[headerMap.YOUR_TURN_EN - 1], RM_DAILY_TALK_PRACTICE_CUES.NEWS_DRILLS.en);
    assert.equal(row[headerMap.YOUR_TURN_KO - 1], RM_DAILY_TALK_PRACTICE_CUES.NEWS_DRILLS.ko);
  });

  test('the Kakao teaser carries the first line, the count and the source', () => {
    const teaser = row[headerMap['카카오본문'] - 1];
    assert.includes(teaser, '(광고) 라이언멤버스 Ryan Daily Talk');
    assert.includes(teaser, NEWS_SAMPLE.topicKo);
    assert.includes(teaser, NEWS_SAMPLE.news.summaryKo[0]);
    assert.includes(teaser, '오늘의 키워드 5개 · 패턴 문장 10개');
    assert.includes(teaser, '출처: 매일경제 2026-11-21');
    assert.excludes(teaser, 'http');
  });
});

describe('buildContentRepairPrompt', () => {
  test('keeps the schema and lists the failed checks', () => {
    const prompt = buildContentPrompt('BUSINESS', { news: NEWS_CANDIDATES });
    const repair = buildContentRepairPrompt(prompt, {
      ok: false,
      errors: [{ field: 'keywords[0].drills[0].highlight', message: '패턴이 문장에 그대로 들어 있지 않습니다.' }]
    });
    assert.equal(repair.schemaName, prompt.schemaName);
    assert.deepEqual(repair.schema, prompt.schema);
    assert.includes(repair.user, prompt.user);
    assert.includes(repair.user, 'keywords[0].drills[0].highlight');
    assert.includes(repair.user, 'Return the whole JSON again');
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
