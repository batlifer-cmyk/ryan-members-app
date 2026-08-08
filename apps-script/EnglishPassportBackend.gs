const RM_PASSPORT_CONFIG = Object.freeze({
  SPREADSHEET_ID: '1P42_8yxR0Tlys8g48Cq1h4SryRHzTlljE0A-bvngwnE',
  REGISTRATION_SHEET: '_DB_등록신청',
  CONTACT_SHEET: '학생연락처',
  DAILY_TALK_CONSENT_VERSION: '2026-07-25-v2',
  KAKAO_CHANNEL_URL: 'https://pf.kakao.com/_xkFxexfX/friend'
});

/**
 * English Passport submission entry point.
 * This function is designed for google.script.run or doPost().
 */
function submitPassport(input) {
  const payload = sanitizePassportPayload_(input || {});
  validatePassportPayload_(payload);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(RM_PASSPORT_CONFIG.SPREADSHEET_ID);
    const registrationSheet = getRequiredSheet_(ss, RM_PASSPORT_CONFIG.REGISTRATION_SHEET);
    const contactSheet = getRequiredSheet_(ss, RM_PASSPORT_CONFIG.CONTACT_SHEET);
    const now = new Date();
    const submissionId = Utilities.getUuid();

    const optIn = payload.dailyTalkOptIn === true;
    const track = resolveDailyTalkTrack_(payload.dailyTalkTrack, payload.courseType);
    const consentAt = optIn ? now : '';
    const consentVersion = optIn ? RM_PASSPORT_CONFIG.DAILY_TALK_CONSENT_VERSION : '';
    const dailyTalkStatus = optIn ? 'ACTIVE' : 'INACTIVE';

    registrationSheet.appendRow([
      submissionId,                         // A 제출ID
      now,                                  // B 제출일시
      payload.studentName,                  // C 학생명
      payload.phone,                        // D 전화번호
      payload.registrationType,             // E 등록구분
      payload.lessonCount,                  // F 신청회차
      payload.courseType,                   // G 수업유형
      payload.teacher,                      // H 담당강사
      payload.learningGoal,                 // I 학습목표
      '동의',                               // J 개인정보동의
      '영어여권웹',                         // K 제출경로
      '대기',                               // L 학생매칭상태
      '대기',                               // M 결제매칭상태
      '접수',                               // N 처리상태
      '',                                   // O 등록로그ID
      JSON.stringify({...payload, serverTimestamp: now.toISOString()}), // P 원본요청JSON
      optIn,                                // Q dailyTalkOptIn
      track,                                // R dailyTalkTrack
      consentAt,                            // S dailyTalkConsentAt
      consentVersion,                       // T dailyTalkConsentVersion
      false,                                // U kakaoChannelAdded
      dailyTalkStatus,                      // V dailyTalkStatus
      ''                                    // W lastDailyTalkSentAt
    ]);

    const contactResult = upsertPassportContact_(contactSheet, {
      studentName: payload.studentName,
      phone: payload.phone,
      dailyTalkOptIn: optIn,
      dailyTalkTrack: track,
      dailyTalkConsentAt: consentAt,
      dailyTalkConsentVersion: consentVersion,
      kakaoChannelAdded: false,
      dailyTalkStatus,
      lastDailyTalkSentAt: ''
    });

    return {
      ok: true,
      submissionId,
      studentName: payload.studentName,
      lessonCount: payload.lessonCount,
      learningGoal: payload.learningGoal,
      dailyTalkOptIn: optIn,
      dailyTalkTrack: track,
      dailyTalkStatus,
      contactAction: contactResult.action,
      kakaoChannelUrl: RM_PASSPORT_CONFIG.KAKAO_CHANNEL_URL
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Records that the completion-page channel button was clicked.
 * This is a click event, not proof that Kakao friend-add was completed.
 */
function markKakaoChannelAdded(submissionId, phone) {
  const normalizedPhone = normalizePhone_(phone);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = SpreadsheetApp.openById(RM_PASSPORT_CONFIG.SPREADSHEET_ID);
    const registrationSheet = getRequiredSheet_(ss, RM_PASSPORT_CONFIG.REGISTRATION_SHEET);
    const contactSheet = getRequiredSheet_(ss, RM_PASSPORT_CONFIG.CONTACT_SHEET);

    if (submissionId) {
      const registrationValues = registrationSheet.getDataRange().getValues();
      for (let rowIndex = 1; rowIndex < registrationValues.length; rowIndex += 1) {
        if (String(registrationValues[rowIndex][0]) === String(submissionId)) {
          registrationSheet.getRange(rowIndex + 1, 21).setValue(true); // U
          break;
        }
      }
    }

    const contactRow = findContactRowByPhone_(contactSheet, normalizedPhone);
    if (contactRow) contactSheet.getRange(contactRow, 12).setValue(true); // L

    return {ok: true, submissionId, phone: normalizedPhone, recordedAs: 'CHANNEL_BUTTON_CLICKED'};
  } finally {
    lock.releaseLock();
  }
}

/**
 * Daily Talk sender source. No separate applicant DB is required.
 */
function getActiveDailyTalkRecipients() {
  const ss = SpreadsheetApp.openById(RM_PASSPORT_CONFIG.SPREADSHEET_ID);
  const sheet = getRequiredSheet_(ss, RM_PASSPORT_CONFIG.CONTACT_SHEET);
  const values = sheet.getDataRange().getValues();
  const recipients = [];

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const studentName = String(row[0] || row[5] || '').trim(); // A or F
    const phone = normalizePhone_(row[3] || row[6] || row[2] || row[1]); // D, G, C, B
    const optIn = toBoolean_(row[7]);       // H
    const track = String(row[8] || 'SMALL_TALK').trim(); // I
    const status = String(row[12] || '').trim();         // M
    const lastSentAt = row[13] || '';                    // N

    if (!studentName || !/^010-\d{4}-\d{4}$/.test(phone)) continue;
    if (!optIn || status !== 'ACTIVE') continue;

    recipients.push({
      sourceRow: rowIndex + 1,
      studentName,
      phone,
      track: ['SMALL_TALK', 'BUSINESS', 'BOTH'].includes(track) ? track : 'SMALL_TALK',
      lastDailyTalkSentAt: lastSentAt
    });
  }

  return recipients;
}

function markDailyTalkSent(phone, sentAt) {
  const normalizedPhone = normalizePhone_(phone);
  const ss = SpreadsheetApp.openById(RM_PASSPORT_CONFIG.SPREADSHEET_ID);
  const sheet = getRequiredSheet_(ss, RM_PASSPORT_CONFIG.CONTACT_SHEET);
  const row = findContactRowByPhone_(sheet, normalizedPhone);
  if (!row) return {ok: false, reason: 'CONTACT_NOT_FOUND'};
  sheet.getRange(row, 14).setValue(sentAt ? new Date(sentAt) : new Date()); // N
  return {ok: true, row};
}

function doPost(e) {
  try {
    const payload = parseWebAppPayload_(e);
    const action = String(payload.action || 'submitPassport');
    let result;
    if (action === 'markKakaoChannelAdded') {
      result = markKakaoChannelAdded(payload.submissionId, payload.phone);
    } else {
      result = submitPassport(payload);
    }
    return jsonOutput_({ok: true, result});
  } catch (error) {
    return jsonOutput_({ok: false, error: error.message || String(error)});
  }
}

function parseWebAppPayload_(e) {
  if (!e) return {};
  const content = e.postData && e.postData.contents ? e.postData.contents : '';
  if (content) {
    try { return JSON.parse(content); } catch (_) { /* form payload fallback */ }
  }
  return {...(e.parameter || {})};
}

function sanitizePassportPayload_(input) {
  const courseType = String(input.courseType || '').trim();
  const optIn = toBoolean_(input.dailyTalkOptIn);
  return {
    studentName: String(input.studentName || '').trim(),
    phone: normalizePhone_(input.phone),
    registrationType: String(input.registrationType || '').trim(),
    lessonCount: String(input.lessonCount || '').replace(/[^0-9]/g, ''),
    courseType,
    teacher: String(input.teacher || '').trim(),
    learningGoal: String(input.learningGoal || '').trim(),
    privacyConsent: toBoolean_(input.privacyConsent),
    dailyTalkOptIn: optIn,
    dailyTalkTrack: resolveDailyTalkTrack_(input.dailyTalkTrack, courseType),
    dailyTalkConsentAt: optIn ? String(input.dailyTalkConsentAt || '') : '',
    dailyTalkConsentVersion: optIn ? RM_PASSPORT_CONFIG.DAILY_TALK_CONSENT_VERSION : '',
    kakaoChannelAdded: false,
    dailyTalkStatus: optIn ? 'ACTIVE' : 'INACTIVE',
    lastDailyTalkSentAt: '',
    userAgent: String(input.userAgent || '')
  };
}

function validatePassportPayload_(payload) {
  if (!payload.studentName) throw new Error('학생명을 입력해 주세요.');
  if (!/^010-\d{4}-\d{4}$/.test(payload.phone)) throw new Error('휴대전화번호를 정확히 입력해 주세요.');
  if (!['신규등록', '재등록', '추가등록'].includes(payload.registrationType)) throw new Error('등록 구분을 선택해 주세요.');
  const lessonCount = Number(payload.lessonCount);
  if (!Number.isInteger(lessonCount) || lessonCount < 1 || lessonCount > 300) throw new Error('등록 회차는 1회부터 300회 사이여야 합니다.');
  if (!payload.courseType) throw new Error('등록 과목을 입력해 주세요.');
  if (!payload.learningGoal) throw new Error('학습 목표를 선택해 주세요.');
  if (!payload.privacyConsent) throw new Error('개인정보 수집·이용 동의가 필요합니다.');
  if (payload.dailyTalkOptIn && !['SMALL_TALK', 'BUSINESS', 'BOTH'].includes(payload.dailyTalkTrack)) {
    throw new Error('받을 Daily Talk를 선택해 주세요.');
  }
}

function upsertPassportContact_(sheet, data) {
  const rowNumber = findContactRowByPhone_(sheet, data.phone);
  const targetRow = rowNumber || Math.max(sheet.getLastRow() + 1, 2);

  if (targetRow > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), Math.max(100, targetRow - sheet.getMaxRows()));
  }

  const currentName = String(sheet.getRange(targetRow, 1).getValue() || '').trim();
  if (!currentName) sheet.getRange(targetRow, 1).setValue(data.studentName); // A
  sheet.getRange(targetRow, 3).setValue(data.phone);  // C 수동입력
  sheet.getRange(targetRow, 4).setValue(data.phone);  // D 최종전화번호
  sheet.getRange(targetRow, 8, 1, 7).setValues([[
    data.dailyTalkOptIn,
    data.dailyTalkTrack,
    data.dailyTalkConsentAt,
    data.dailyTalkConsentVersion,
    data.kakaoChannelAdded,
    data.dailyTalkStatus,
    data.lastDailyTalkSentAt
  ]]);

  return {action: rowNumber ? 'UPDATED' : 'ADDED', row: targetRow};
}

function findContactRowByPhone_(sheet, phone) {
  if (!phone) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, 1, lastRow - 1, Math.min(sheet.getLastColumn(), 14)).getValues();
  for (let index = 0; index < values.length; index += 1) {
    const row = values[index];
    const candidates = [row[3], row[6], row[2], row[1]].map(normalizePhone_);
    if (candidates.includes(phone)) return index + 2;
  }
  return 0;
}

function resolveDailyTalkTrack_(requestedTrack, courseType) {
  const track = String(requestedTrack || '').trim().toUpperCase();
  return ['SMALL_TALK', 'BUSINESS', 'BOTH'].includes(track)
    ? track
    : classifyDailyTalkTrack_(courseType);
}

function classifyDailyTalkTrack_(courseType) {
  const text = String(courseType || '').toLowerCase().replace(/\s+/g, ' ');
  const smallKeywords = ['일상회화', '여행영어', '여행 영어', '왕초보', '스몰톡', '사교영어'];
  const businessKeywords = ['비즈니스 영어', '비즈니스', '직장인 영어', '직장인'];
  const hasSmall = smallKeywords.some(keyword => text.indexOf(keyword) !== -1);
  const hasBusiness = businessKeywords.some(keyword => text.indexOf(keyword) !== -1);
  if (hasSmall && hasBusiness) return 'BOTH';
  if (hasBusiness) return 'BUSINESS';
  return 'SMALL_TALK';
}

function normalizePhone_(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.indexOf('010') === 0) {
    return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
  }
  return String(value || '').trim();
}

function toBoolean_(value) {
  return value === true || ['true', 'TRUE', '1', 'yes', 'YES', '동의'].includes(String(value || ''));
}

function getRequiredSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error("필수 시트 '" + name + "'를 찾을 수 없습니다.");
  return sheet;
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
