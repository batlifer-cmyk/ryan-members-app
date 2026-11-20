/**
 * Local DOM check for the /rm-magazine/{slug} article renderer (not part of CI).
 *
 * It publishes a queue row through the real publisher code (the same
 * DailyTalkWixPublisher.gs that runs in Apps Script), turns the resulting
 * contentHtml into the rich-text DOM Wix serves, and lets rm-daily-talk.js
 * rebuild it — so the publisher -> article -> card contract is exercised end
 * to end without a browser.
 *
 * Run: node .domtest/magazine-dom.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const RENDERER = fs.readFileSync(path.join(ROOT, 'wix', 'rm-magazine', 'rm-daily-talk.js'), 'utf8');

// --- the Apps Script sources, so the article text is the real one ----------
const sandbox = {
  console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, Error, TypeError,
  isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent
};
vm.createContext(sandbox);
['PassportCore.gs', 'DailyTalkContentGenerator.gs', 'DailyTalkWixPublisher.gs'].forEach((name) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script', name), 'utf8'), sandbox, { filename: name });
});

const FIVE_STEP_ITEM = {
  contentId: 'SMALL_TALK-20261120-warm-coffee-morning',
  sendDate: '2026-11-20',
  track: 'SMALL_TALK',
  level: 'BASIC',
  topicEn: 'Warm Coffee Morning',
  topicKo: '따뜻한 커피 아침',
  snackEn: 'You walk to work on a cold morning and stop for a coffee.',
  snackKo: '추운 아침에 걸어서 출근하다가 커피를 사요.',
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
  sources: 'OPENAI:gpt-5.5'
};

/** A business card: same five steps, step 5 is a Message House. */
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
  sources: 'OPENAI:gpt-5.5'
};

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
  sources: 'OPENAI:gpt-5.5'
};

const LEGACY_ITEM = {
  contentId: 'SMALL_TALK-20261119-cold-morning-chat',
  track: 'SMALL_TALK',
  topicEn: 'Frosty Elevator Hello',
  topicKo: '쌀쌀한 엘리베이터 인사',
  snackEn: 'You meet a neighbor in the elevator on a very cold morning.',
  snackKo: '아주 추운 아침에 엘리베이터에서 이웃을 만났어요.',
  chunksJson: JSON.stringify([{ en: "It's freezing this morning.", ko: '오늘 아침 정말 춥네요.' }]),
  wordOrderJson: JSON.stringify([
    { thoughtKo: '오늘 아침은 / 정말 / 춥다', orderKo: '오늘 아침은 / 추운 / 정말', en: "It's really cold this morning." }
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

/** The article body Wix renders, with <br> turned into real line breaks. */
function articleHtml(item) {
  const data = sandbox.buildDailyTalkCmsData_(item);
  return data.contentHtml.split('<br>').join('\n');
}

function renderPage(item, title) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    if (!/Not implemented/.test(String(error))) console.error('jsdom', error.message);
  });
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
    '<main class="page"><div class="wixui-rich-text"><h1>' + title + '</h1></div>' +
    '<div class="wixui-rich-content-viewer"><div class="rich">' + articleHtml(item) + '</div></div></main>' +
    '</body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://www.ryanmembers.com/rm-magazine/test', virtualConsole }
  );
  dom.window.eval(RENDERER);
  return dom;
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(['PASS', name]);
  } catch (error) {
    results.push(['FAIL', name + ' :: ' + error.message]);
  }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function texts(root, selector) {
  return Array.from(root.querySelectorAll(selector)).map((el) => el.textContent.trim());
}

(async () => {
  // --- the five steps -----------------------------------------------------
  const five = renderPage(FIVE_STEP_ITEM, '[Small Talk] 따뜻한 커피 아침');
  await wait(600);
  const doc = five.window.document;
  const article = doc.getElementById('rmdt-root');

  check('draws the article and hides the raw CMS text', () => {
    if (!article) throw new Error('no #rmdt-root');
    const viewer = doc.querySelector('[class*="wixui-rich-content-viewer"]');
    if (five.window.getComputedStyle(viewer).display !== 'none') throw new Error('viewer not hidden');
  });

  check('renders five step cards in order with the Korean sub-label', () => {
    const cards = Array.from(doc.querySelectorAll('.rmdt-card'));
    const steps = cards.map((card) => card.dataset.step).join(',');
    if (steps !== '1,2,3,4,5') throw new Error('steps: ' + steps);
    const names = cards.map((card) => card.querySelector('.rmdt-name').textContent.trim()).join('|');
    if (names !== 'KEY WORDS|KOREAN SENTENCES|ENGLISH WORD ORDER|ENGLISH SENTENCES|AAA IN ACTION') {
      throw new Error('names: ' + names);
    }
    const subs = cards.map((card) => card.querySelector('.rmdt-sub').textContent.trim()).join('|');
    if (subs !== '오늘의 단어 3개|그 단어로 만든 한국어 문장|영어 어순으로 재정렬|통번역한 영어 문장|실제 대화 3문장') {
      throw new Error('subs: ' + subs);
    }
  });

  check('step 1 shows the three words with their meanings', () => {
    const card = doc.querySelector('.rmdt-card[data-step="1"]');
    const words = texts(card, '.rmdt-word-en');
    if (words.join('|') !== 'warm coffee|on my way to work|grab') throw new Error('words: ' + words.join('|'));
    const meanings = texts(card, '.rmdt-word-ko');
    if (meanings[0] !== '따뜻한 커피') throw new Error('meanings: ' + meanings.join('|'));
  });

  check('step 2 shows the three Korean sentences with matching marks', () => {
    const card = doc.querySelector('.rmdt-card[data-step="2"]');
    const rows = Array.from(card.querySelectorAll('.rmdt-sentences-row'));
    if (rows.length !== 3) throw new Error('rows: ' + rows.length);
    const marks = rows.map((row) => row.querySelector('.rmdt-mark').textContent).join('');
    if (marks !== '①②③') throw new Error('marks: ' + marks);
    if (rows[1].querySelector('.rmdt-sentence-text').textContent.trim() !== '나는 출근길에 커피를 사서 들었다') {
      throw new Error('second sentence: ' + rows[1].textContent);
    }
  });

  check('step 3 lays the sentence out as role chips in English word order', () => {
    const card = doc.querySelector('.rmdt-card[data-step="3"]');
    const orders = Array.from(card.querySelectorAll('.rmdt-order'));
    if (orders.length !== 3) throw new Error('orders: ' + orders.length);
    const first = orders[0];
    const roles = texts(first, '.rmdt-chip-role').join('/');
    if (roles !== '누가/한다/무엇을/어디서/언제') throw new Error('roles: ' + roles);
    const pieces = texts(first, '.rmdt-chip-text').join('/');
    if (pieces !== '나는/마셨다/따뜻한 커피를/출근길에/오늘 아침') throw new Error('pieces: ' + pieces);
    if (first.querySelectorAll('.rmdt-chip-sep').length !== 4) throw new Error('separators: ' + first.querySelectorAll('.rmdt-chip-sep').length);
    if (first.querySelector('.rmdt-mark').textContent !== '①') throw new Error('mark: ' + first.querySelector('.rmdt-mark').textContent);
  });

  check('step 4 shows the English translations under the same marks', () => {
    const card = doc.querySelector('.rmdt-card[data-step="4"]');
    const rows = Array.from(card.querySelectorAll('.rmdt-english-row'));
    if (rows.length !== 3) throw new Error('rows: ' + rows.length);
    if (rows[0].querySelector('.rmdt-mark').textContent !== '①') throw new Error('mark: ' + rows[0].textContent);
    if (rows[2].querySelector('.rmdt-english-text').textContent.trim() !== 'I need a warm coffee in the morning.') {
      throw new Error('third: ' + rows[2].textContent);
    }
  });

  check('step 5 shows the picked sentence and Answer / Add / Ask badges', () => {
    const card = doc.querySelector('.rmdt-card[data-step="5"]');
    const pick = card.querySelector('.rmdt-pick');
    if (!pick) throw new Error('no pick box');
    if (pick.querySelector('.rmdt-pick-label').textContent.trim() !== '오늘 고른 문장 ①') {
      throw new Error('pick label: ' + pick.textContent);
    }
    if (pick.querySelector('.rmdt-pick-en').textContent.trim() !== 'I had a warm coffee on my way to work this morning.') {
      throw new Error('pick en: ' + pick.textContent);
    }
    const blocks = Array.from(card.querySelectorAll('.rmdt-aaa-block'));
    if (blocks.length !== 3) throw new Error('blocks: ' + blocks.length);
    const badges = blocks.map((block) => block.querySelector('.rmdt-aaa-badge').textContent.trim()).join('|');
    if (badges !== 'ANSWER|ADD|ASK') throw new Error('badges: ' + badges);
    const hints = blocks.map((block) => block.querySelector('.rmdt-aaa-hint').textContent.trim()).join('|');
    if (hints !== '한 문장으로 먼저 답하기|이유나 디테일을 한 문장 더하기|상대에게 되묻기') throw new Error('hints: ' + hints);
    if (blocks[1].querySelector('.rmdt-aaa-ko').textContent.trim() !== '밖이 정말 추웠거든요.') throw new Error('add ko');
  });

  check('keeps the closing CTA card with its three live links', () => {
    const cta = article.querySelector('.rmdt-cta');
    if (!cta) throw new Error('no CTA');
    const button = cta.querySelector('.rmdt-cta-btn');
    if (button.getAttribute('href') !== 'https://www.ryanmembers.com/?dailytalk=1') throw new Error('href: ' + button.getAttribute('href'));
    if (button.textContent.replace(/\s+/g, '') !== '무료로받기→') throw new Error('label: ' + button.textContent);
    const links = Array.from(cta.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    if (links.length !== 3) throw new Error('links: ' + links.join(','));
    if (links[2] !== 'https://pf.kakao.com/_xkFxexfX/friend') throw new Error('kakao: ' + links[2]);
  });

  check('sits directly under the page title and does not repeat the Korean topic', () => {
    const heading = doc.querySelector('h1');
    const titleBox = heading.closest('.wixui-rich-text') || heading;
    if (titleBox.nextElementSibling !== article) throw new Error('article is not under the page title');
    if (article.querySelector('.rmdt-title-ko')) throw new Error('hero repeats the Korean title');
    if (article.querySelector('.rmdt-title-en').textContent.trim() !== 'Warm Coffee Morning') throw new Error('hero title');
  });
  five.window.close();

  // --- a business card: step 5 is the Message House -------------------------
  const business = renderPage(BUSINESS_MESSAGE_HOUSE_ITEM, '[Business Talk] 하루 더 필요한 상황');
  await wait(600);
  const businessDoc = business.window.document;

  check('a business card draws the same five steps, with MESSAGE HOUSE as step 5', () => {
    const cards = Array.from(businessDoc.querySelectorAll('.rmdt-card'));
    if (cards.map((card) => card.dataset.step).join(',') !== '1,2,3,4,5') {
      throw new Error('steps: ' + cards.map((c) => c.dataset.step).join(','));
    }
    const names = cards.map((card) => card.querySelector('.rmdt-name').textContent.trim()).join('|');
    if (names !== 'KEY WORDS|KOREAN SENTENCES|ENGLISH WORD ORDER|ENGLISH SENTENCES|MESSAGE HOUSE') {
      throw new Error('names: ' + names);
    }
    const subs = cards[4].querySelector('.rmdt-sub').textContent.trim();
    if (subs !== '결론 → 근거 → 디테일') throw new Error('step 5 sub: ' + subs);
  });

  check('step 5 shows the picked sentence and the four Message House blocks', () => {
    const card = businessDoc.querySelector('.rmdt-card[data-step="5"]');
    if (!card.classList.contains('is-message-house')) throw new Error('no is-message-house class');
    const pick = card.querySelector('.rmdt-pick');
    if (!pick) throw new Error('no pick box');
    if (pick.querySelector('.rmdt-pick-label').textContent.trim() !== '오늘 고른 문장 ①') {
      throw new Error('pick label: ' + pick.textContent);
    }
    if (pick.querySelector('.rmdt-pick-ko').textContent.trim() !== '우리는 출시에 하루가 더 필요합니다') {
      throw new Error('pick ko: ' + pick.textContent);
    }
    const blocks = Array.from(card.querySelectorAll('.rmdt-aaa-block'));
    if (blocks.length !== 4) throw new Error('blocks: ' + blocks.length);
    const roles = blocks.map((block) => block.getAttribute('data-role')).join('|');
    if (roles !== 'conclusion|reason|detail|suggestion') throw new Error('roles: ' + roles);
    const badges = blocks.map((block) => block.querySelector('.rmdt-aaa-badge').textContent.trim()).join('|');
    if (badges !== 'CONCLUSION|REASON|DETAIL|SUGGESTION') throw new Error('badges: ' + badges);
    const hints = blocks.map((block) => block.querySelector('.rmdt-aaa-hint').textContent.trim()).join('|');
    if (hints !== '핵심 결론부터 말하기|근거 기둥 세우기|구체적인 디테일 붙이기|다음 행동 제안하기') {
      throw new Error('hints: ' + hints);
    }
    if (blocks[2].querySelector('.rmdt-aaa-ko').textContent.trim() !== '둘 다 결제 화면에 있습니다.') {
      throw new Error('detail ko');
    }
  });

  check('the business card keeps the closing CTA and its live links', () => {
    const cta = businessDoc.querySelector('.rmdt-cta');
    if (!cta) throw new Error('no CTA');
    if (cta.querySelector('.rmdt-cta-btn').getAttribute('href') !== 'https://www.ryanmembers.com/?dailytalk=1') {
      throw new Error('CTA href');
    }
  });
  business.window.close();

  // --- a business card with no next step: three sentences -------------------
  const shortItem = Object.assign({}, BUSINESS_MESSAGE_HOUSE_ITEM, {
    structureJson: JSON.stringify({ type: 'MESSAGE_HOUSE', pick: 1, steps: JSON.parse(BUSINESS_MESSAGE_HOUSE_ITEM.structureJson).steps.slice(0, 3) })
  });
  const shortHouse = renderPage(shortItem, '[Business Talk] 하루 더 필요한 상황');
  await wait(600);
  check('a Message House with no Suggestion draws three blocks', () => {
    const card = shortHouse.window.document.querySelector('.rmdt-card[data-step="5"]');
    const blocks = Array.from(card.querySelectorAll('.rmdt-aaa-block'));
    if (blocks.length !== 3) throw new Error('blocks: ' + blocks.length);
    if (blocks.map((block) => block.querySelector('.rmdt-aaa-badge').textContent.trim()).join('|') !== 'CONCLUSION|REASON|DETAIL') {
      throw new Error('badges: ' + blocks.map((block) => block.textContent).join(' / '));
    }
  });
  shortHouse.window.close();

  // --- a business news card: briefing + 5 keyword cards ---------------------
  const newsPage = renderPage(NEWS_ITEM, '[Business Talk] 금리 동결');
  await wait(600);
  const newsDoc = newsPage.window.document;

  check('a news card draws the briefing first, then five keyword cards', () => {
    const cards = Array.from(newsDoc.querySelectorAll('.rmdt-card'));
    const steps = cards.map((card) => card.dataset.step).join(',');
    if (steps !== 'news,keyword,keyword,keyword,keyword,keyword') throw new Error('steps: ' + steps);
    const newsCard = cards[0];
    if (newsCard.querySelector('.rmdt-name').textContent.trim() !== "TODAY'S BUSINESS NEWS") {
      throw new Error('news name: ' + newsCard.textContent.slice(0, 80));
    }
    if (newsCard.querySelector('.rmdt-news-headline').textContent.trim() !== 'Fed holds rates steady, signals one more cut') {
      throw new Error('headline');
    }
    const lines = texts(newsCard, '.rmdt-news-line');
    if (lines.join('|') !== NEWS_SUMMARY.join('|')) throw new Error('lines: ' + lines.join('|'));
    if (newsCard.querySelector('.rmdt-news-source-text').textContent.trim() !== '매일경제 · 2026-11-21') {
      throw new Error('source: ' + newsCard.querySelector('.rmdt-news-source').textContent);
    }
  });

  check('the briefing lists the five keywords as jump links to their cards', () => {
    const newsCard = newsDoc.querySelector('.rmdt-card[data-step="news"]');
    const links = Array.from(newsCard.querySelectorAll('.rmdt-kw-index-link'));
    if (links.length !== 5) throw new Error('links: ' + links.length);
    if (links[0].getAttribute('href') !== '#rmdt-keyword-1') throw new Error('href: ' + links[0].getAttribute('href'));
    if (links[4].querySelector('.rmdt-kw-index-text').textContent.trim() !== 'rate cut') throw new Error('last label');
    if (!newsDoc.getElementById('rmdt-keyword-5')) throw new Error('no keyword 5 anchor');
  });

  check('each keyword card shows the expression, meaning, usage and two drills', () => {
    const cards = Array.from(newsDoc.querySelectorAll('.rmdt-card[data-step="keyword"]'));
    if (cards.length !== 5) throw new Error('cards: ' + cards.length);
    cards.forEach((card, index) => {
      const word = NEWS_KEYWORDS[index];
      if (card.querySelector('.rmdt-step').textContent.trim() !== 'KEYWORD ' + (index + 1)) throw new Error('badge ' + index);
      if (card.querySelector('.rmdt-kw-title').textContent.trim() !== word.en) throw new Error('title ' + index);
      if (card.querySelector('.rmdt-kw-ko').textContent.trim() !== word.ko) throw new Error('meaning ' + index);
      if (card.querySelector('.rmdt-kw-usage-text').textContent.trim() !== word.usageKo) throw new Error('usage ' + index);
      const drills = Array.from(card.querySelectorAll('.rmdt-drill'));
      if (drills.length !== 2) throw new Error('drills ' + index + ': ' + drills.length);
      drills.forEach((drill, drillIndex) => {
        if (drill.querySelector('.rmdt-drill-badge').textContent.trim() !== 'DRILL ' + (drillIndex + 1)) throw new Error('badge');
        if (drill.querySelector('.rmdt-drill-en').textContent.trim() !== word.drills[drillIndex].en) throw new Error('en ' + index + '/' + drillIndex);
        if (drill.querySelector('.rmdt-drill-ko').textContent.trim() !== word.drills[drillIndex].ko) throw new Error('ko');
      });
    });
  });

  check('each drill marks its pattern inside the English sentence', () => {
    const newsCards = Array.from(newsDoc.querySelectorAll('.rmdt-card[data-step="keyword"]'));
    const marks = [];
    newsCards.forEach((card) => {
      Array.from(card.querySelectorAll('.rmdt-hl')).forEach((mark) => marks.push(mark.textContent));
    });
    if (marks.length !== 10) throw new Error('highlights: ' + marks.length);
    if (marks[0] !== 'held rates steady') throw new Error('first highlight: ' + marks[0]);
    if (marks[1] !== 'holding prices steady') throw new Error('second highlight: ' + marks[1]);
    marks.forEach((mark, index) => {
      const word = NEWS_KEYWORDS[Math.floor(index / 2)];
      const expected = word.drills[index % 2].highlight;
      if (mark !== expected) throw new Error('highlight ' + index + ': ' + mark + ' != ' + expected);
    });
  });

  check('the news card keeps the closing CTA and its live links', () => {
    const cta = newsDoc.querySelector('.rmdt-cta');
    if (!cta) throw new Error('no CTA');
    if (cta.querySelector('.rmdt-cta-btn').getAttribute('href') !== 'https://www.ryanmembers.com/?dailytalk=1') {
      throw new Error('CTA href');
    }
    if (cta.querySelectorAll('a').length !== 3) throw new Error('CTA links');
  });

  check('the news card does not draw the five-step cards', () => {
    if (newsDoc.querySelector('.rmdt-card[data-step="1"]')) throw new Error('unexpected step 1');
    if (newsDoc.querySelector('.rmdt-snack')) throw new Error('unexpected snack block');
  });
  newsPage.window.close();

  // --- articles published before 2026-11-20 -------------------------------
  const legacy = renderPage(LEGACY_ITEM, '[Small Talk] 쌀쌀한 엘리베이터 인사');
  await wait(600);
  const legacyDoc = legacy.window.document;
  check('an older four-step article still renders its four cards and the CTA', () => {
    const cards = Array.from(legacyDoc.querySelectorAll('.rmdt-card'));
    if (cards.map((card) => card.dataset.step).join(',') !== '1,2,3,4') throw new Error('steps: ' + cards.map((c) => c.dataset.step).join(','));
    const names = cards.map((card) => card.querySelector('.rmdt-name').textContent.trim()).join('|');
    if (names !== 'KEY CHUNKS|WORD ORDER|AAA|MODEL & YOUR TURN') throw new Error('names: ' + names);
    if (!legacyDoc.querySelector('.rmdt-card[data-step="3"] .rmdt-stage-en')) throw new Error('no stage text');
    if (!legacyDoc.querySelector('.rmdt-cta')) throw new Error('no CTA');
  });
  legacy.window.close();

  // --- an article with no STEP headings ------------------------------------
  const plainDom = new JSDOM(
    '<!doctype html><html><body><h1>[Small Talk] 옛 기사</h1>' +
    '<div class="wixui-rich-content-viewer"><p>예전 글 본문입니다.</p><p>STEP 없이 그냥 문단만 있습니다.</p></div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://www.ryanmembers.com/rm-magazine/old', virtualConsole: new VirtualConsole() }
  );
  plainDom.window.eval(RENDERER);
  await wait(600);
  check('leaves an article without STEP headings exactly as the CMS sent it', () => {
    const plainDoc = plainDom.window.document;
    if (plainDoc.getElementById('rmdt-root')) throw new Error('unexpected article');
    const viewer = plainDoc.querySelector('[class*="wixui-rich-content-viewer"]');
    if (plainDom.window.getComputedStyle(viewer).display === 'none') throw new Error('viewer was hidden');
  });
  plainDom.window.close();

  const failed = results.filter((row) => row[0] === 'FAIL');
  results.forEach((row) => console.log(row[0] + '  ' + row[1]));
  console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
