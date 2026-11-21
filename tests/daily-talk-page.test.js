/**
 * Standalone Daily Talk page (apps-script/DailyTalk.html) source contract.
 *
 * The page is server-rendered through HtmlService (`?mode=dailytalk`), so the
 * consent sentence and the Kakao friend URL come from Apps Script constants
 * rather than being retyped here. These checks pin the fields the brief asks
 * for, the submit call, and the copy that must not over-claim.
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(ROOT, 'apps-script', 'DailyTalk.html'), 'utf8');

describe('DailyTalk.html — standalone sign-up', () => {
  test('asks for name, phone, one of three tracks and consent', () => {
    assert.includes(html, 'id="studentName"');
    assert.includes(html, 'id="phone"');
    assert.includes(html, 'value="SMALL_TALK"');
    assert.includes(html, 'value="BUSINESS"');
    assert.includes(html, 'value="BOTH"');
    assert.includes(html, 'id="consent"');
    assert.includes(html, 'type="checkbox"');
  });

  test('renders the consent sentence and version from the backend constants', () => {
    assert.includes(html, '<?= pageConfig.consentText ?>');
    assert.includes(html, 'data-consent-version="<?= pageConfig.consentVersion ?>"');
  });

  test('submits through submitDailyTalkOnly with the light payload only', () => {
    assert.includes(html, '.submitDailyTalkOnly(payload)');
    assert.excludes(html, 'submitPassport(');
    const collect = html.slice(html.indexOf('function collect()'), html.indexOf('function validate('));
    assert.includes(collect, 'studentName');
    assert.includes(collect, 'phone');
    assert.includes(collect, 'dailyTalkTrack');
    assert.includes(collect, 'dailyTalkConsent');
    assert.excludes(collect, 'registrationType');
    assert.excludes(collect, 'lessonCount');
    assert.excludes(collect, 'courseType');
  });

  test('validates a 010 number before calling the server', () => {
    assert.includes(html, '/^010-\\d{4}-\\d{4}$/');
    assert.includes(html, "replace(/[^0-9]/g, '')");
  });

  test('puts the Kakao channel add button right after completion', () => {
    assert.includes(html, 'id="kakaoBtn"');
    assert.includes(html, 'href="<?= pageConfig.kakaoFriendUrl ?>"');
    assert.includes(html, 'rel="noopener noreferrer"');
    const done = html.indexOf('id="doneView"');
    const kakao = html.indexOf('id="kakaoBtn"');
    assert.ok(done !== -1 && kakao > done, 'Kakao CTA must live on the completion view');
  });

  test('tells a repeat submission that only the track changed', () => {
    assert.includes(html, "result.action === 'UPDATED'");
    assert.includes(html, '트랙이 변경되었습니다.');
    assert.includes(html, '수업 등록 정보는 그대로');
  });

  test('never claims a confirmed Kakao friend add or a registration', () => {
    assert.excludes(html, 'kakaoChannelAdded');
    assert.excludes(html, '수강 등록이 완료');
    assert.includes(html, '수업 등록과는 별개입니다');
  });

  test('works as a full-screen iframe: own viewport and no external assets', () => {
    assert.includes(html, 'width=device-width');
    assert.excludes(html, 'http://');
    assert.excludes(html, 'cdn.');
    assert.excludes(html, '<iframe');
  });
});
