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
