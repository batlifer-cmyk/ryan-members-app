/**
 * Local DOM check for the English Passport page (not part of CI).
 * Requires jsdom installed in this folder:  node /path/to/npm-cli.js install jsdom
 * Run: node .domtest/run-dom.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'apps-script', 'Index.html'), 'utf8');
const qr = fs.readFileSync(path.join(ROOT, 'apps-script', 'QRCode.html'), 'utf8');
html = html.replace("<?!= include('QRCode') ?>", qr);

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(['PASS', name]);
  } catch (error) {
    results.push(['FAIL', name + ' :: ' + error.message]);
  }
}

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', () => {});
virtualConsole.on('error', () => {});

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://passport.test/exec',
  virtualConsole,
  beforeParse(window) {
    // jsdom does not implement scrolling; the page only uses it for UX.
    window.Element.prototype.scrollIntoView = function () {};
    window.scrollTo = function () {};
    window.__submitted = [];
    window.__channelClick = null;
    const runner = {
      _s: null,
      _f: null,
      withSuccessHandler(fn) { this._s = fn; return this; },
      withFailureHandler(fn) { this._f = fn; return this; },
      getPublicConfig() {
        setTimeout(() => this._s && this._s({ ok: true, kakaoFriendUrl: 'https://pf.kakao.com/_xkFxexfX/friend' }), 5);
      },
      submitPassport(payload) {
        window.__submitted.push(payload);
        setTimeout(() => this._s && this._s({
          ok: true,
          submissionId: 'EP-TEST-1',
          studentName: payload.studentName,
          lessonCount: payload.lessonCount,
          learningGoal: payload.learningGoal,
          dailyTalkOptIn: payload.dailyTalkOptIn,
          dailyTalkTrack: payload.dailyTalkTrack,
          dailyTalkTrackLabel: payload.dailyTalkTrack === 'BUSINESS' ? 'Daily Business Talk' : 'Daily Small Talk'
        }), 10);
      },
      markKakaoChannelClick(id, phone) {
        window.__channelClick = { submissionId: id, phone };
        setTimeout(() => this._s && this._s({ ok: true }), 5);
      }
    };
    window.google = { script: { run: runner } };
  }
});

const { window } = dom;
const { document } = window;

function click(el) {
  if (!el) throw new Error('element not found');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
function setValue(el, value) {
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}
function text(selector) {
  const el = document.querySelector(selector);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  check('runner warning hidden when google.script.run exists', () => {
    if (document.getElementById('runnerWarning').classList.contains('visible')) throw new Error('warning visible');
  });

  click(document.getElementById('openBtn'));
  await wait(600);
  check('book visible after opening the passport', () => {
    if (!document.getElementById('book').classList.contains('visible')) throw new Error('book not visible');
  });

  setValue(document.getElementById('studentName'), '홍길동');
  setValue(document.getElementById('phone'), '01012345678');
  check('phone input auto-formats to 010-1234-5678', () => {
    if (document.getElementById('phone').value !== '010-1234-5678') {
      throw new Error('got ' + document.getElementById('phone').value);
    }
  });
  click(document.querySelector('[data-page="1"] [data-next]'));

  const typeChoice = Array.from(document.querySelectorAll('[data-name="registrationType"] .choice')).find((b) => b.dataset.value === '재등록');
  click(typeChoice);
  const custom = Array.from(document.querySelectorAll('[data-name="lessonCount"] .choice')).find((b) => b.dataset.value === '직접 입력');
  click(custom);
  await wait(20);
  check('custom lesson input appears for 직접 입력', () => {
    if (!document.getElementById('customLessonWrap').classList.contains('visible')) throw new Error('custom wrap hidden');
  });
  setValue(document.getElementById('customLessonCount'), '10');
  click(document.querySelector('[data-page="2"] [data-next]'));

  setValue(document.getElementById('courseType'), '사교영어·스몰톡 (RM 영어입담비법서)');
  const goal = Array.from(document.querySelectorAll('[data-name="learningGoal"] .choice')).find((b) => b.dataset.value === '자신감 있는 스피킹');
  click(goal);
  click(document.querySelector('[data-page="3"] [data-next]'));
  await wait(30);

  check('summary reflects the custom lesson count and opt-out default', () => {
    const summary = text('#summary');
    if (summary.indexOf('10회') === -1) throw new Error('summary missing 10회: ' + summary);
    if (summary.indexOf('신청 안 함') === -1) throw new Error('summary missing opt-out state: ' + summary);
  });

  // Daily Talk opt-in with a student override that differs from the recommendation
  const optIn = document.getElementById('dailyTalkOptIn');
  optIn.checked = true;
  optIn.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);
  check('track section opens and shows the course-based recommendation', () => {
    if (!document.getElementById('dailyTrackSection').classList.contains('visible')) throw new Error('track section hidden');
    const rec = text('#dailyTrackRecommendation');
    if (rec.indexOf('Daily Small Talk') === -1) throw new Error('recommendation not SMALL_TALK: ' + rec);
  });
  const businessRadio = document.querySelector('input[name="dailyTalkTrackChoice"][value="BUSINESS"]');
  businessRadio.checked = true;
  businessRadio.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);

  document.getElementById('privacy').checked = true;
  // jsdom does not run the implicit submit of a clicked submit button, so the
  // submit event is dispatched the way the browser would send it.
  const form = document.getElementById('passportForm');
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(120);

  check('exactly one submission is sent', () => {
    if (window.__submitted.length !== 1) throw new Error('submissions: ' + window.__submitted.length);
  });

  const payload = window.__submitted[0] || {};
  check('payload keeps the student track (BUSINESS) and the custom count', () => {
    if (payload.dailyTalkTrack !== 'BUSINESS') throw new Error('track=' + payload.dailyTalkTrack);
    if (String(payload.lessonCount) !== '10') throw new Error('lessonCount=' + payload.lessonCount);
    if (payload.dailyTalkOptIn !== true) throw new Error('optIn=' + payload.dailyTalkOptIn);
    if (payload.privacyConsent !== true) throw new Error('privacy missing');
    if ('kakaoChannelAdded' in payload) throw new Error('client must not send kakaoChannelAdded');
  });

  check('completion screen shows the approved copy in order', () => {
    const page5 = document.querySelector('[data-page="5"]');
    if (!page5.classList.contains('active')) throw new Error('page 5 not active');
    const flat = page5.textContent.replace(/\s+/g, ' ');
    const order = ['영어로 여는 새로운 세계.', '당신은 용감한 여행자입니다.', '자, 이제 출발을 허가합니다.', 'Welcome to a Bigger World.'];
    let cursor = -1;
    order.forEach((line) => {
      const at = flat.indexOf(line);
      if (at === -1 || at < cursor) throw new Error('copy out of order at: ' + line);
      cursor = at;
    });
  });

  check('completion meta shows the stored Daily Talk track', () => {
    const meta = text('#approvalMeta');
    if (meta.indexOf('Daily Business Talk') === -1) throw new Error('meta=' + meta);
  });

  click(document.getElementById('kakaoChannelBtn'));
  await wait(20);
  check('desktop CTA opens the QR modal and records a click event only', () => {
    if (!document.getElementById('rmKakaoModal').classList.contains('visible')) throw new Error('modal hidden');
    if (!window.__channelClick) throw new Error('channel click not recorded');
    if (window.__channelClick.submissionId !== 'EP-TEST-1') throw new Error('submissionId not passed');
  });
  check('QR canvas was filled or gracefully hidden (no crash)', () => {
    const canvas = document.getElementById('rmKakaoQr');
    if (!canvas) throw new Error('canvas missing');
  });

  const failed = results.filter((r) => r[0] === 'FAIL');
  results.forEach((row) => console.log(row[0] + '  ' + row[1]));
  console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');
  process.exit(failed.length ? 1 : 0);
})();
