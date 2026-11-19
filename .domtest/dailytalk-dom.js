/**
 * Local DOM check for the standalone Daily Talk page (not part of CI).
 * Run: node .domtest/dailytalk-dom.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = {
  consentText: '라이언멤버스의 평일 영어 학습 콘텐츠를 카카오톡으로 받겠습니다. 광고성 정보 수신에 동의하며, 카카오톡 채널 차단을 통해 언제든 중단할 수 있습니다.',
  consentVersion: '2026-11-20-dailytalk-only-v1',
  kakaoFriendUrl: 'https://pf.kakao.com/_xkFxexfX/friend'
};
const html = fs.readFileSync(path.join(ROOT, 'apps-script', 'DailyTalk.html'), 'utf8')
  .replace(/<\?=\s*pageConfig\.consentText\s*\?>/g, CONFIG.consentText)
  .replace(/<\?=\s*pageConfig\.consentVersion\s*\?>/g, CONFIG.consentVersion)
  .replace(/<\?=\s*pageConfig\.kakaoFriendUrl\s*\?>/g, CONFIG.kakaoFriendUrl);

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(['PASS', name]);
  } catch (error) {
    results.push(['FAIL', name + ' :: ' + error.message]);
  }
}
function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => { if (!/Not implemented/.test(String(error))) console.error('jsdom', error.message); });

function makeDom(serverResult) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://script.google.com/exec?mode=dailytalk',
    virtualConsole,
    beforeParse(window) {
      window.scrollTo = function () {};
      window.Element.prototype.scrollIntoView = function () {};
      window.__submitted = [];
      window.__clicks = [];
      const runner = {
        _s: null,
        _f: null,
        withSuccessHandler(fn) { this._s = fn; return this; },
        withFailureHandler(fn) { this._f = fn; return this; },
        submitDailyTalkOnly(payload) {
          window.__submitted.push(payload);
          setTimeout(() => this._s && this._s(serverResult(payload)), 5);
        },
        markKakaoChannelClick(id, phone) {
          window.__clicks.push([id, phone]);
          setTimeout(() => this._s && this._s({ ok: true }), 5);
        }
      };
      window.google = { script: { run: runner } };
    }
  });
  return dom;
}

const dom = makeDom((payload) => ({
  ok: true,
  mode: 'DAILY_TALK_ONLY',
  action: payload.phone === '010-0000-9999' ? 'UPDATED' : 'ADDED',
  studentName: '홍길동',
  dailyTalkTrack: payload.dailyTalkTrack,
  dailyTalkTrackLabel: payload.dailyTalkTrack === 'BUSINESS' ? 'Daily Business Talk' : (payload.dailyTalkTrack === 'BOTH' ? '두 콘텐츠 모두' : 'Daily Small Talk'),
  registrationRecorded: false
}));
const { window } = dom;
const document = window.document;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  await wait(50);

  check('shows the form with the server-side consent sentence', () => {
    assert(document.getElementById('formView').style.display !== 'none', 'form must start visible');
    assert(!document.getElementById('doneView').classList.contains('visible'), 'completion must start hidden');
    const text = document.getElementById('consent').parentElement.textContent;
    assert(text.indexOf('광고성 정보 수신에 동의') !== -1, 'consent text missing');
  });

  check('formats the phone number while typing', () => {
    const phone = document.getElementById('phone');
    phone.value = '0101234567';
    phone.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert(phone.value === '010-1234-567', 'got ' + phone.value);
    phone.value = '01012345678';
    phone.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert(phone.value === '010-1234-5678', 'got ' + phone.value);
  });

  check('blocks an empty submit and says what is missing', () => {
    document.getElementById('dtForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    const error = document.getElementById('error');
    assert(error.classList.contains('visible'), 'error box must show');
    assert(error.textContent.indexOf('이름') !== -1, 'got ' + error.textContent);
    assert(window.__submitted.length === 0, 'must not call the server');
  });

  check('requires an explicit track choice', () => {
    document.getElementById('studentName').value = '홍길동';
    document.getElementById('dtForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert(document.getElementById('error').textContent.indexOf('Daily Talk를 선택') !== -1, 'got ' + document.getElementById('error').textContent);
  });

  check('requires the consent checkbox', () => {
    document.querySelector('input[name="track"][value="BOTH"]').checked = true;
    document.getElementById('dtForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert(document.getElementById('error').textContent.indexOf('동의') !== -1, 'got ' + document.getElementById('error').textContent);
    assert(window.__submitted.length === 0, 'must not call the server');
  });

  check('submits name, phone, track and consent only', async () => {
    document.getElementById('consent').checked = true;
    document.getElementById('dtForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await wait(30);
    assert(window.__submitted.length === 1, 'expected one submit, got ' + window.__submitted.length);
    const payload = window.__submitted[0];
    assert(payload.studentName === '홍길동', 'name');
    assert(payload.phone === '010-1234-5678', 'phone');
    assert(payload.dailyTalkTrack === 'BOTH', 'track ' + payload.dailyTalkTrack);
    assert(payload.dailyTalkConsent === true, 'consent');
    assert(payload.consentVersion === CONFIG.consentVersion, 'consent version');
    assert(!('registrationType' in payload) && !('lessonCount' in payload), 'no registration fields');
  });

  check('moves to the completion view with the Kakao channel button', async () => {
    const done = document.getElementById('doneView');
    assert(done.classList.contains('visible'), 'completion must be visible');
    assert(document.getElementById('formView').style.display === 'none', 'form must be hidden');
    assert(document.getElementById('doneTrack').textContent === '두 콘텐츠 모두', 'got ' + document.getElementById('doneTrack').textContent);
    const kakao = document.getElementById('kakaoBtn');
    assert(kakao.getAttribute('href') === CONFIG.kakaoFriendUrl, 'kakao href');
  });

  check('records the channel click once, best effort', async () => {
    document.getElementById('kakaoBtn').dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
    document.getElementById('kakaoBtn').dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
    await wait(20);
    assert(window.__clicks.length === 1, 'expected one click record, got ' + window.__clicks.length);
    assert(window.__clicks[0][1] === '010-1234-5678', 'phone on click');
  });

  check('a repeat submission reports a track change', async () => {
    document.getElementById('againBtn').click();
    assert(document.getElementById('formView').style.display !== 'none', 'form must come back');
    document.getElementById('studentName').value = '최진혁';
    document.getElementById('phone').value = '010-0000-9999';
    document.querySelector('input[name="track"][value="BUSINESS"]').checked = true;
    document.getElementById('dtForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await wait(30);
    assert(document.getElementById('doneTitle').textContent === '트랙이 변경되었습니다.', 'got ' + document.getElementById('doneTitle').textContent);
    assert(document.getElementById('doneLead').textContent.indexOf('수업 등록 정보는 그대로') !== -1, 'got ' + document.getElementById('doneLead').textContent);
  });

  const failed = results.filter((row) => row[0] === 'FAIL');
  results.forEach((row) => console.log(row[0] + '  ' + row[1]));
  console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');
  dom.window.close();
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
