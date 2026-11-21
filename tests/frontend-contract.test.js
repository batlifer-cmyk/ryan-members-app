const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPS_DIR = path.join(ROOT, 'apps-script');
const indexHtml = fs.readFileSync(path.join(APPS_DIR, 'Index.html'), 'utf8');
const indexFlat = indexHtml.replace(/\s+/g, ' ');

describe('Index.html — product copy contract', () => {
  test('contains the exact Daily Talk consent sentence', () => {
    assert.includes(indexFlat,
      '영어여권 발급 후 라이언멤버스의 평일 영어 학습 콘텐츠를 카카오톡으로 받겠습니다. 광고성 정보 수신에 동의하며, 카카오톡 채널 차단을 통해 언제든 중단할 수 있습니다.');
  });

  test('marks the Daily Talk consent as optional and unchecked by default', () => {
    const checkboxTag = indexHtml.match(/<input[^>]*id="dailyTalkOptIn"[^>]*>/);
    assert.ok(checkboxTag, 'consent checkbox must exist');
    assert.excludes(checkboxTag[0], 'checked', 'consent checkbox must not be pre-checked');
    assert.includes(indexFlat, '선택 동의입니다. 체크하지 않아도 영어여권 등록은 정상 처리됩니다.');
    // and the script must not flip it on at load
    assert.excludes(indexHtml, 'optInCheckbox.checked = true');
  });

  test('offers the three final track choices', () => {
    ['SMALL_TALK', 'BUSINESS', 'BOTH'].forEach((track) => {
      assert.includes(indexHtml, 'value="' + track + '"');
    });
    assert.includes(indexFlat, 'Daily Small Talk');
    assert.includes(indexFlat, 'Daily Business Talk');
    assert.includes(indexFlat, '두 콘텐츠 모두');
  });

  test('keeps the recommendation and the student choice as separate concepts', () => {
    assert.includes(indexHtml, 'dailyTrackRecommendation');
    assert.includes(indexHtml, '등록 과목 기준 추천:');
    assert.includes(indexHtml, 'data-touched');
  });

  test('completion copy appears in the required order', () => {
    const titleAt = indexHtml.indexOf('영어로 여는 새로운 세계.');
    const travelerAt = indexHtml.indexOf('당신은 용감한 여행자입니다.');
    const permitAt = indexHtml.indexOf('자, 이제 출발을 허가합니다.');
    const worldAt = indexHtml.indexOf('Welcome to a Bigger World.');
    assert.ok(titleAt > -1 && travelerAt > titleAt && permitAt > travelerAt && worldAt > permitAt,
      'completion copy must appear in order: ' + [titleAt, travelerAt, permitAt, worldAt].join(','));
  });

  test('is a single page: no iframe chain and no GitHub CDN loader', () => {
    assert.excludes(indexHtml.toLowerCase(), '<iframe');
    assert.excludes(indexHtml, 'rawcdn.githack');
    assert.excludes(indexHtml, 'passport-v');
    assert.excludes(indexHtml, 'passportFrame');
  });

  test('has no external script/style requests (only the vendored QR include)', () => {
    assert.excludes(indexHtml, '<script src=');
    assert.excludes(indexHtml, '<link ');
    assert.includes(indexHtml, "include('QRCode')");
  });

  test('has no preview mock submission left', () => {
    assert.excludes(indexHtml, 'PREVIEW-DEMO');
    assert.excludes(indexHtml, '운영 전 미리보기');
    assert.excludes(indexHtml, 'window.google = { script: { run: runner }');
  });

  test('wires the real google.script.run submitPassport call', () => {
    assert.includes(indexHtml, 'google.script.run');
    assert.includes(indexHtml, '.submitPassport(payload)');
    assert.includes(indexHtml, '.markKakaoChannelClick(');
    assert.includes(indexHtml, 'if (!result || result.ok !== true)');
  });

  test('never claims a confirmed Kakao friend add', () => {
    assert.excludes(indexHtml, 'kakaoChannelAdded = true');
    assert.excludes(indexHtml, 'kakaoChannelAdded: true');
    assert.excludes(indexHtml, 'kakaoChannelAdded=true');
  });

  test('ships both the direct mobile friend link and the desktop QR modal', () => {
    assert.includes(indexHtml, 'https://pf.kakao.com/_xkFxexfX/friend');
    assert.includes(indexHtml, 'id="rmKakaoModal"');
    assert.includes(indexHtml, 'id="rmKakaoQr"');
    assert.includes(indexHtml, "window.qrcode(0, 'H')");
    assert.includes(indexHtml, '카카오톡 앱에서 바로 채널 추가');
    assert.includes(indexHtml, '휴대폰으로 카카오톡 채널 추가');
  });

  test('supports custom lesson count and the full course list', () => {
    assert.includes(indexHtml, 'id="customLessonCount"');
    assert.includes(indexHtml, 'value="직접 입력"');
    assert.includes(indexFlat, '맞춤형 1:1 프라이빗 영어교육');
    assert.includes(indexFlat, '사교영어·스몰톡 (RM 영어입담비법서)');
    assert.includes(indexFlat, 'TOEIC Speaking');
    assert.includes(indexFlat, '쿠킹 영어');
    assert.includes(indexFlat, '2:1 세미프라이빗 영어회화');
  });

  test('formats the phone input as 010-XXXX-XXXX', () => {
    assert.includes(indexHtml, "phoneInput.value = formatted");
    assert.includes(indexHtml, "digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7)");
  });
});

describe('Apps Script sources — load and export contract', () => {
  const sandbox = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, Error, isFinite, isNaN, parseInt, parseFloat
  };
  vm.createContext(sandbox);
  ['PassportCore.gs', 'EnglishPassportBackend.gs', 'DailyTalkWixPublisher.gs'].forEach((file) => {
    const source = fs.readFileSync(path.join(APPS_DIR, file), 'utf8');
    vm.runInContext(source, sandbox, { filename: file });
  });

  test('backend exposes doGet, submitPassport, audience and click tracking', () => {
    ['doGet', 'doPost', 'submitPassport', 'markKakaoChannelClick', 'getActiveDailyTalkRecipients',
      'refreshDailyTalkAudienceMirror', 'getPublicConfig', 'setupEnglishPassport'].forEach((name) => {
      assert.equal(typeof sandbox[name], 'function', name + ' must be defined');
    });
  });

  test('publisher exposes the pipeline and the controlled test send', () => {
    ['runDailyTalkPipeline', 'sendDailyTalkTestToOwner', 'publishDailyTalkToWix_', 'inspectDailyTalkSheets'].forEach((name) => {
      assert.equal(typeof sandbox[name], 'function', name + ' must be defined');
    });
  });

  test('doGet serves Index.html through HtmlService, not a redirect', () => {
    const source = fs.readFileSync(path.join(APPS_DIR, 'EnglishPassportBackend.gs'), 'utf8');
    assert.includes(source, "HtmlService.createTemplateFromFile('Index')");
    assert.includes(source, 'HtmlService.XFrameOptionsMode.ALLOWALL');
  });

  test('production constants match the agreed rollout values', () => {
    const source = fs.readFileSync(path.join(APPS_DIR, 'DailyTalkWixPublisher.gs'), 'utf8');
    assert.includes(source, 'BMS_TARGETING: \'I\'');
    assert.includes(source, 'TEST_MODE: true');
    assert.includes(source, 'DISABLE_SMS_FALLBACK: true');
    assert.includes(source, 'disableSms: true');
    assert.includes(source, 'targeting: targeting');
    const backend = fs.readFileSync(path.join(APPS_DIR, 'EnglishPassportBackend.gs'), 'utf8');
    assert.includes(backend, "DAILY_TALK_CONSENT_VERSION: '2026-07-25-v2'");
    assert.includes(backend, "KAKAO_FRIEND_URL: 'https://pf.kakao.com/_xkFxexfX/friend'");
  });

  test('refuses to send when BMS_TARGETING drifts away from I', () => {
    const source = fs.readFileSync(path.join(APPS_DIR, 'DailyTalkWixPublisher.gs'), 'utf8');
    assert.includes(source, "if (targeting !== 'I')");
  });

  test('declares the Asia/Seoul timezone and minimal scopes', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(APPS_DIR, 'appsscript.json'), 'utf8'));
    assert.equal(manifest.timeZone, 'Asia/Seoul');
    assert.deepEqual(manifest.oauthScopes, [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/script.scriptapp'
    ]);
    assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
    assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
  });
});
