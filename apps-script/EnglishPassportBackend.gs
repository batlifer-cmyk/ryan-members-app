/**
 * EnglishPassportBackend.gs
 *
 * Owns the student-facing English Passport:
 *  - doGet() serves the single-page Index.html (no CDN/iframe chain).
 *  - submitPassport() validates, writes one `_DB_등록신청` row and upserts the
 *    matching `학생연락처` row (no separate Daily Talk applicant database).
 *  - getActiveDailyTalkRecipients() is the send audience for Daily Talk.
 *
 * Column positions are resolved from the header row by name (see
 * RM_REGISTRATION_COLUMN_SPEC / RM_CONTACT_COLUMN_SPEC) and missing optional
 * columns are appended once, so a re-ordered or extended sheet keeps working.
 *
 * Secrets are never read from code: only PropertiesService.
 */

var RM_PASSPORT_CONFIG = Object.freeze({
  SPREADSHEET_ID: '1P42_8yxR0Tlys8g48Cq1h4SryRHzTlljE0A-bvngwnE',
  REGISTRATION_SHEET: '_DB_등록신청',
  CONTACT_SHEET: '학생연락처',
  DAILY_TALK_OPERATIONS_SPREADSHEET_ID: '1vpPKVhDOj9Np5RL-Afu7vTHTqm4gfG3M5MCqkWmUeDE',
  DAILY_TALK_AUDIENCE_SHEET: '발송대상',
  DAILY_TALK_CONSENT_VERSION: '2026-07-25-v2',
  DAILY_TALK_CONSENT_TEXT: '영어여권 발급 후 라이언멤버스의 평일 영어 학습 콘텐츠를 카카오톡으로 받겠습니다. 광고성 정보 수신에 동의하며, 카카오톡 채널 차단을 통해 언제든 중단할 수 있습니다.',
  KAKAO_CHANNEL_PUBLIC_ID: '_xkFxexfX',
  KAKAO_FRIEND_URL: 'https://pf.kakao.com/_xkFxexfX/friend',
  TIMEZONE: 'Asia/Seoul',
  AUDIENCE_CACHE_SECONDS: 600
});

var RM_REGISTRATION_COLUMN_SPEC = Object.freeze([
  { field: '제출ID', aliases: ['submissionId', '제출 아이디'], required: true },
  { field: '제출일시', aliases: ['submittedAt', '제출 일시', '신청일시'], required: true },
  { field: '학생명', aliases: ['이름', '성명', 'studentName'], required: true },
  { field: '전화번호', aliases: ['휴대전화번호', '휴대폰번호', '연락처', 'phone'], required: true },
  { field: '등록구분', aliases: ['registrationType', '등록 구분'], required: true },
  { field: '신청회차', aliases: ['lessonCount', '등록회차', '회차'], required: true },
  { field: '수업유형', aliases: ['등록과목', '과목', 'courseType', '수업 유형'], required: true },
  { field: '담당강사', aliases: ['강사', 'teacher', '담당 강사'], required: false },
  { field: '학습목표', aliases: ['learningGoal', '목표', '학습 목표'], required: false },
  { field: '개인정보동의', aliases: ['privacyConsent', '개인정보 동의'], required: false },
  { field: '제출경로', aliases: ['source', '제출 경로'], required: false },
  { field: '학생매칭상태', aliases: ['studentMatchStatus'], required: false },
  { field: '결제매칭상태', aliases: ['paymentMatchStatus'], required: false },
  { field: '처리상태', aliases: ['processingStatus'], required: false },
  { field: '등록로그ID', aliases: ['registrationLogId'], required: false },
  { field: '원본요청JSON', aliases: ['rawRequestJson', '원본요청'], required: false },
  { field: 'dailyTalkOptIn', aliases: ['데일리톡동의', 'dailyTalk옵트인'], required: false },
  { field: 'dailyTalkTrack', aliases: ['데일리톡트랙'], required: false },
  { field: 'dailyTalkConsentAt', aliases: ['데일리톡동의시각'], required: false },
  { field: 'dailyTalkConsentVersion', aliases: ['데일리톡동의버전'], required: false },
  { field: 'kakaoChannelAdded', aliases: ['채널추가확인'], required: false },
  { field: 'dailyTalkStatus', aliases: ['데일리톡상태'], required: false },
  { field: 'lastDailyTalkSentAt', aliases: ['마지막발송일', '데일리톡마지막발송'], required: false },
  { field: 'kakaoChannelClickAt', aliases: ['채널버튼클릭시각'], required: false },
  { field: 'kakaoChannelAddedAt', aliases: ['채널추가확인시각'], required: false }
]);

var RM_CONTACT_COLUMN_SPEC = Object.freeze([
  { field: '학생명', aliases: ['이름', '성명', 'studentName'], required: true },
  { field: '전화번호', aliases: ['최종전화번호', '휴대전화번호', '휴대폰번호', '연락처', 'phone'], required: true },
  { field: '수동입력', aliases: ['수동 입력', 'manualPhone'], required: false },
  { field: 'dailyTalkOptIn', aliases: ['데일리톡동의'], required: false },
  { field: 'dailyTalkTrack', aliases: ['데일리톡트랙'], required: false },
  { field: 'dailyTalkConsentAt', aliases: ['데일리톡동의시각'], required: false },
  { field: 'dailyTalkConsentVersion', aliases: ['데일리톡동의버전'], required: false },
  { field: 'kakaoChannelAdded', aliases: ['채널추가확인'], required: false },
  { field: 'dailyTalkStatus', aliases: ['데일리톡상태'], required: false },
  { field: 'lastDailyTalkSentAt', aliases: ['마지막발송일', '데일리톡마지막발송'], required: false },
  { field: 'kakaoChannelClickAt', aliases: ['채널버튼클릭시각'], required: false },
  { field: 'kakaoChannelAddedAt', aliases: ['채널추가확인시각'], required: false }
]);

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------

/**
 * Student-facing page. Deployed with "execute as: me" and "access: anyone"
 * so Wix can embed the /exec URL directly.
 */
function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.action === 'health') {
    return jsonOutput_({
      ok: true,
      app: 'english-passport',
      version: rmPassportVersion_(),
      timezone: RM_PASSPORT_CONFIG.TIMEZONE,
      serverTime: nowIso_(),
      consentVersion: RM_PASSPORT_CONFIG.DAILY_TALK_CONSENT_VERSION
    });
  }

  var html = HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Ryan Members English Passport')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return html;
}

/** Include helper for HtmlService templates. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Non-secret configuration for the page (called through google.script.run). */
function getPublicConfig() {
  return {
    ok: true,
    kakaoFriendUrl: RM_PASSPORT_CONFIG.KAKAO_FRIEND_URL,
    kakaoChannelPublicId: RM_PASSPORT_CONFIG.KAKAO_CHANNEL_PUBLIC_ID,
    consentVersion: RM_PASSPORT_CONFIG.DAILY_TALK_CONSENT_VERSION,
    consentText: RM_PASSPORT_CONFIG.DAILY_TALK_CONSENT_TEXT,
    trackLabels: RM_TRACK_LABELS,
    timezone: RM_PASSPORT_CONFIG.TIMEZONE,
    serverTime: nowIso_()
  };
}

/**
 * Submits the English Passport.
 * Returns {ok:true, ...} on success and {ok:false, errors:[...]} for a
 * validation problem, so the page can show the message next to the field.
 */
function submitPassport(input) {
  var now = new Date();
  var submissionId = 'EP-' + Utilities.formatDate(now, RM_PASSPORT_CONFIG.TIMEZONE, 'yyyyMMdd-HHmmss') +
    '-' + Utilities.getUuid().slice(0, 8);

  var payload = sanitizePassportPayload(input || {}, {
    consentVersion: RM_PASSPORT_CONFIG.DAILY_TALK_CONSENT_VERSION,
    submittedAt: now.toISOString()
  });
  var validation = validatePassportPayload(payload);
  if (!validation.ok) {
    return {
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      message: validation.errors[0].message,
      errors: validation.errors
    };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return { ok: false, errorCode: 'BUSY', message: '접수가 잠시 몰리고 있습니다. 잠시 후 다시 시도해 주세요.' };
  }

  try {
    var ss = SpreadsheetApp.openById(rmRegistrationSpreadsheetId_());
    var registrationSheet = getRequiredSheet_(ss, rmRegistrationSheetName_());
    var contactSheet = getRequiredSheet_(ss, rmContactSheetName_());

    var registrationMap = ensureHeaderColumns_(registrationSheet, RM_REGISTRATION_COLUMN_SPEC);
    var contactMap = ensureHeaderColumns_(contactSheet, RM_CONTACT_COLUMN_SPEC);

    var registrationFields = buildRegistrationFields(payload, {
      submissionId: submissionId,
      nowIso: now.toISOString()
    });
    appendRowFromFields_(registrationSheet, registrationMap, registrationFields);

    var contactResult = upsertContactRow_(contactSheet, contactMap, payload, now);
    invalidateAudienceCache_();

    return {
      ok: true,
      submissionId: submissionId,
      studentName: payload.studentName,
      lessonCount: payload.lessonCount,
      courseType: payload.courseType,
      learningGoal: payload.learningGoal,
      dailyTalkOptIn: payload.dailyTalkOptIn,
      dailyTalkTrack: payload.dailyTalkTrack,
      dailyTalkTrackLabel: payload.dailyTalkOptIn ? (RM_TRACK_LABELS[payload.dailyTalkTrack] || payload.dailyTalkTrack) : '',
      dailyTalkStatus: payload.dailyTalkStatus,
      contactAction: contactResult.action,
      kakaoFriendUrl: RM_PASSPORT_CONFIG.KAKAO_FRIEND_URL,
      message: '출발이 허가되었습니다.'
    };
  } catch (error) {
    logPassportError_('submitPassport', error, { submissionId: submissionId, phone: maskPhone(payload.phone) });
    return {
      ok: false,
      errorCode: 'SERVER_ERROR',
      message: '접수 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.',
      detail: String(error && error.message ? error.message : error)
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Records that the student pressed the Kakao channel button.
 * This is a click event, NOT proof of a friend add: kakaoChannelAdded stays
 * false until an official Kakao callback confirms it
 * (see applyKakaoChannelAddedCallback_).
 */
function markKakaoChannelClick(submissionId, phone) {
  var normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return { ok: false, errorCode: 'INVALID_PHONE' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, errorCode: 'BUSY' };
  try {
    var ss = SpreadsheetApp.openById(rmRegistrationSpreadsheetId_());
    var clickedAt = new Date().toISOString();
    var registrationUpdated = false;

    var registrationSheet = getRequiredSheet_(ss, rmRegistrationSheetName_());
    var registrationMap = ensureHeaderColumns_(registrationSheet, RM_REGISTRATION_COLUMN_SPEC);
    if (submissionId && registrationMap['제출ID'] && registrationMap['kakaoChannelClickAt']) {
      var matchRow = findRowByValue_(registrationSheet, registrationMap['제출ID'], submissionId);
      if (matchRow) {
        registrationSheet.getRange(matchRow, registrationMap['kakaoChannelClickAt']).setValue(clickedAt);
        registrationUpdated = true;
      }
    }

    var contactSheet = getRequiredSheet_(ss, rmContactSheetName_());
    var contactMap = ensureHeaderColumns_(contactSheet, RM_CONTACT_COLUMN_SPEC);
    var contactRow = findContactRowByPhone_(contactSheet, contactMap, normalizedPhone);
    if (contactRow && contactMap['kakaoChannelClickAt']) {
      contactSheet.getRange(contactRow, contactMap['kakaoChannelClickAt']).setValue(clickedAt);
    }

    return {
      ok: true,
      submissionId: submissionId || '',
      phone: maskPhone(normalizedPhone),
      recordedAs: 'CHANNEL_BUTTON_CLICKED',
      registrationUpdated: registrationUpdated,
      contactRow: contactRow || 0
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Owner-only: flips kakaoChannelAdded to true after an official Kakao callback.
 * Requires the Script Property KAKAO_CALLBACK_TOKEN and must never be called
 * from the browser.
 */
function applyKakaoChannelAddedCallback_(token, phone) {
  var expected = PropertiesService.getScriptProperties().getProperty('KAKAO_CALLBACK_TOKEN');
  if (!expected) throw new Error('KAKAO_CALLBACK_TOKEN is not configured.');
  if (String(token || '') !== expected) throw new Error('Invalid callback token.');

  var normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw new Error('Invalid phone.');

  var ss = SpreadsheetApp.openById(rmRegistrationSpreadsheetId_());
  var contactSheet = getRequiredSheet_(ss, rmContactSheetName_());
  var contactMap = ensureHeaderColumns_(contactSheet, RM_CONTACT_COLUMN_SPEC);
  var row = findContactRowByPhone_(contactSheet, contactMap, normalizedPhone);
  if (!row) return { ok: false, errorCode: 'CONTACT_NOT_FOUND' };

  var nowIso = new Date().toISOString();
  contactSheet.getRange(row, contactMap['kakaoChannelAdded']).setValue(true);
  if (contactMap['kakaoChannelAddedAt']) {
    contactSheet.getRange(row, contactMap['kakaoChannelAddedAt']).setValue(nowIso);
  }
  invalidateAudienceCache_();
  return { ok: true, phone: maskPhone(normalizedPhone), kakaoChannelAdded: true };
}

/**
 * Optional JSON endpoint (kept for non-browser clients and health checks).
 * The student page itself uses google.script.run.
 */
function doPost(e) {
  try {
    var payload = parseWebAppPayload_(e);
    var action = String(payload.action || 'submitPassport');
    if (action === 'markKakaoChannelClick') {
      return jsonOutput_(markKakaoChannelClick(payload.submissionId, payload.phone));
    }
    return jsonOutput_(submitPassport(payload));
  } catch (error) {
    logPassportError_('doPost', error, {});
    return jsonOutput_({ ok: false, errorCode: 'SERVER_ERROR', message: String(error && error.message ? error.message : error) });
  }
}

// ---------------------------------------------------------------------------
// Daily Talk audience
// ---------------------------------------------------------------------------

/**
 * Active Daily Talk audience, extracted from the English Passport contact data.
 * dailyTalkOptIn = true, dailyTalkStatus = ACTIVE, valid 010 number.
 */
function getActiveDailyTalkRecipients() {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'rmDailyTalkAudience_' + rmContactSheetName();
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      var parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) return parsed;
    } catch (ignored) { /* fall through to a live read */ }
  }

  var ss = SpreadsheetApp.openById(rmRegistrationSpreadsheetId_());
  var sheet = getRequiredSheet_(ss, rmContactSheetName_());
  var map = ensureHeaderColumns_(sheet, RM_CONTACT_COLUMN_SPEC);
  var records = readContactRecords_(sheet, map);
  var result = filterActiveRecipients(records);

  try {
    cache.put(cacheKey, JSON.stringify(result.recipients), RM_PASSPORT_CONFIG.AUDIENCE_CACHE_SECONDS);
  } catch (ignored) { /* cache is an optimisation only */ }

  return result.recipients;
}

/** Audience plus the reason each rejected row was skipped (diagnostics). */
function getDailyTalkAudienceReport() {
  var ss = SpreadsheetApp.openById(rmRegistrationSpreadsheetId_());
  var sheet = getRequiredSheet_(ss, rmContactSheetName_());
  var map = ensureHeaderColumns_(sheet, RM_CONTACT_COLUMN_SPEC);
  var result = filterActiveRecipients(readContactRecords_(sheet, map));
  return {
    ok: true,
    activeCount: result.recipients.length,
    recipients: result.recipients,
    rejectedCount: result.rejected.length,
    rejected: result.rejected
  };
}

/**
 * Writes a light mirror of the active audience into the Daily Talk operations
 * spreadsheet. `_DB_등록신청`/`학생연락처` live in a very large workbook, so the
 * send pipeline prefers this small tab instead of re-reading it every day.
 */
function refreshDailyTalkAudienceMirror() {
  var recipients = getActiveDailyTalkRecipients();
  var ops = SpreadsheetApp.openById(rmDailyTalkOperationsSpreadsheetId_());
  var sheet = ops.getSheetByName(RM_PASSPORT_CONFIG.DAILY_TALK_AUDIENCE_SHEET);
  if (!sheet) sheet = ops.insertSheet(RM_PASSPORT_CONFIG.DAILY_TALK_AUDIENCE_SHEET);

  var syncedAt = nowIso_();
  sheet.clear();
  sheet.getRange(1, 1, 1, 6).setValues([['전화번호', '이름', '트랙', '상태', '동기화시각', 'CONTACT_ROW']]);
  if (recipients.length) {
    var rows = recipients.map(function (recipient) {
      return [recipient.phone, recipient.name, recipient.track, 'ACTIVE', syncedAt, recipient.rowNumber];
    });
    sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  }
  return { ok: true, mirrored: recipients.length, syncedAt: syncedAt };
}

/**
 * Mirror when it was refreshed in the last `maxAgeHours`, otherwise the live
 * contact sheet. This keeps a daily send well inside the Apps Script timeout.
 */
function getAudienceForSend_(options) {
  var opts = options || {};
  var maxAgeHours = typeof opts.maxAgeHours === 'number' ? opts.maxAgeHours : 24;
  try {
    var ops = SpreadsheetApp.openById(rmDailyTalkOperationsSpreadsheetId_());
    var sheet = ops.getSheetByName(RM_PASSPORT_CONFIG.DAILY_TALK_AUDIENCE_SHEET);
    if (sheet && sheet.getLastRow() >= 2) {
      var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
      var syncedAt = values[0] && values[0][4] ? new Date(values[0][4]) : null;
      var fresh = syncedAt && isFinite(syncedAt.getTime()) &&
        (Date.now() - syncedAt.getTime()) <= maxAgeHours * 3600 * 1000;
      if (fresh) {
        var mirrored = values.filter(function (row) { return normalizePhone(row[0]); }).map(function (row) {
          return {
            rowNumber: row[5] || 0,
            name: String(row[1] || ''),
            phone: normalizePhone(row[0]),
            track: normalizeTrack(row[2]) || RM_TRACKS.SMALL_TALK,
            lastDailyTalkSentAt: ''
          };
        });
        return { recipients: mirrored, source: 'MIRROR', syncedAt: syncedAt.toISOString() };
      }
    }
  } catch (error) {
    logPassportError_('getAudienceForSend_ mirror', error, {});
  }
  return { recipients: getActiveDailyTalkRecipients(), source: 'CONTACT_SHEET', syncedAt: '' };
}

/** Marks the last successful Daily Talk send for one contact row. */
function markDailyTalkSent(phone, sentAt) {
  var normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return { ok: false, reason: 'INVALID_PHONE' };
  var ss = SpreadsheetApp.openById(rmRegistrationSpreadsheetId_());
  var sheet = getRequiredSheet_(ss, rmContactSheetName_());
  var map = ensureHeaderColumns_(sheet, RM_CONTACT_COLUMN_SPEC);
  var row = findContactRowByPhone_(sheet, map, normalizedPhone);
  if (!row) return { ok: false, reason: 'CONTACT_NOT_FOUND' };
  sheet.getRange(row, map['lastDailyTalkSentAt']).setValue(sentAt || new Date());
  return { ok: true, row: row };
}

function invalidateAudienceCache_() {
  try {
    CacheService.getScriptCache().remove('rmDailyTalkAudience_' + rmContactSheetName());
  } catch (ignored) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

/** Resolves headers, appending any missing column header once. */
function ensureHeaderColumns_(sheet, spec) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var nonEmpty = headers.filter(function (header) { return String(header || '').trim() !== ''; }).length;

  if (nonEmpty === 0 && sheet.getLastRow() > 1) {
    throw new Error('시트 "' + sheet.getName() + '"의 1행 헤더가 비어 있는데 데이터가 있습니다. 헤더를 먼저 확인해 주세요.');
  }

  var resolved = resolveColumnMap(headers, spec, { createMissing: true });
  if (resolved.missing && resolved.missing.length) {
    var needed = resolved.headerCount;
    if (sheet.getMaxColumns() < needed) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), needed - sheet.getMaxColumns());
    }
    resolved.missing.forEach(function (field) {
      sheet.getRange(1, resolved.map[field]).setValue(field);
    });
  }
  return resolved.map;
}

function appendRowFromFields_(sheet, map, fields) {
  var width = sheet.getLastColumn();
  Object.keys(map).forEach(function (field) {
    if (map[field] > width) width = map[field];
  });
  var row = buildRowValues(map, fields, width);
  if (sheet.getMaxColumns() < row.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), row.length - sheet.getMaxColumns());
  }
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function findRowByValue_(sheet, column, value) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || !column) return 0;
  var keys = sheet.getRange(2, column, lastRow - 1, 1).getValues();
  var target = String(value);
  for (var i = 0; i < keys.length; i += 1) {
    if (String(keys[i][0]) === target) return i + 2;
  }
  return 0;
}

function findContactRowByPhone_(sheet, map, phone) {
  var normalized = normalizePhone(phone);
  if (!normalized) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var columns = [];
  ['전화번호', '수동입력'].forEach(function (field) {
    if (map[field]) columns.push(map[field]);
  });
  if (!columns.length) return 0;

  var maxColumn = Math.max.apply(null, columns);
  var values = sheet.getRange(2, 1, lastRow - 1, maxColumn).getValues();
  for (var i = 0; i < values.length; i += 1) {
    for (var c = 0; c < columns.length; c += 1) {
      if (normalizePhone(values[i][columns[c] - 1]) === normalized) return i + 2;
    }
  }
  return 0;
}

function upsertContactRow_(sheet, map, payload, now) {
  var rowNumber = findContactRowByPhone_(sheet, map, payload.phone);
  var action = rowNumber ? 'UPDATED' : 'ADDED';
  var targetRow = rowNumber;

  if (!targetRow) {
    targetRow = Math.max(sheet.getLastRow() + 1, 2);
    if (targetRow > sheet.getMaxRows()) {
      sheet.insertRowsAfter(sheet.getMaxRows(), Math.max(100, targetRow - sheet.getMaxRows()));
    }
    sheet.getRange(targetRow, map['학생명']).setValue(payload.studentName);
    if (map['전화번호']) sheet.getRange(targetRow, map['전화번호']).setValue(payload.phone);
    if (map['수동입력']) sheet.getRange(targetRow, map['수동입력']).setValue(payload.phone);
  } else {
    var currentName = String(sheet.getRange(targetRow, map['학생명']).getValue() || '').trim();
    if (!currentName) sheet.getRange(targetRow, map['학생명']).setValue(payload.studentName);

    // Keep the primary phone column authoritative and normalized.
    var currentPhone = String(sheet.getRange(targetRow, map['전화번호']).getValue() || '').trim();
    if (!currentPhone) {
      if (map['수동입력'] && normalizePhone(sheet.getRange(targetRow, map['수동입력']).getValue()) === payload.phone) {
        // matched on the manual column only; promote it to the primary column
      }
      sheet.getRange(targetRow, map['전화번호']).setValue(payload.phone);
    }
  }

  // Daily Talk fields. A confirmed friend add (kakaoChannelAdded=true) is never
  // cleared by a later registration.
  var existingKakaoAdded = rowNumber ? toBoolean(sheet.getRange(targetRow, map['kakaoChannelAdded']).getValue()) : false;
  var existingLastSent = rowNumber && map['lastDailyTalkSentAt']
    ? sheet.getRange(targetRow, map['lastDailyTalkSentAt']).getValue()
    : '';

  var fields = buildContactFields(payload);
  fields['kakaoChannelAdded'] = existingKakaoAdded;
  fields['lastDailyTalkSentAt'] = existingLastSent || '';
  if (payload.dailyTalkOptIn) {
    fields['dailyTalkConsentAt'] = now.toISOString();
  }

  Object.keys(fields).forEach(function (field) {
    if (!map[field]) return;
    if (field === '학생명' || field === '전화번호' || field === '수동입력') return;
    if (field === 'kakaoChannelAdded') return; // preserved above, never rewritten by a submit
    sheet.getRange(targetRow, map[field]).setValue(fields[field]);
  });

  return { action: action, row: targetRow, kakaoChannelAdded: existingKakaoAdded };
}

function readContactRecords_(sheet, map) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var maxColumn = Math.max(
    map['학생명'] || 1,
    map['전화번호'] || 1,
    map['수동입력'] || 1,
    map['dailyTalkOptIn'] || 1,
    map['dailyTalkTrack'] || 1,
    map['dailyTalkStatus'] || 1,
    map['lastDailyTalkSentAt'] || 1
  );
  var values = sheet.getRange(2, 1, lastRow - 1, maxColumn).getValues();
  var records = [];
  for (var i = 0; i < values.length; i += 1) {
    var row = values[i];
    var primaryPhone = map['전화번호'] ? row[map['전화번호'] - 1] : '';
    var manualPhone = map['수동입력'] ? row[map['수동입력'] - 1] : '';
    records.push({
      rowNumber: i + 2,
      name: map['학생명'] ? row[map['학생명'] - 1] : '',
      phone: normalizePhone(primaryPhone) || normalizePhone(manualPhone),
      optIn: map['dailyTalkOptIn'] ? row[map['dailyTalkOptIn'] - 1] : false,
      track: map['dailyTalkTrack'] ? row[map['dailyTalkTrack'] - 1] : '',
      status: map['dailyTalkStatus'] ? row[map['dailyTalkStatus'] - 1] : '',
      lastSentAt: map['lastDailyTalkSentAt'] ? row[map['lastDailyTalkSentAt'] - 1] : ''
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Setup / diagnostics
// ---------------------------------------------------------------------------

/**
 * Run once from the Apps Script editor after deployment.
 * Ensures every required Daily Talk column exists and reports the mapping.
 */
function setupEnglishPassport() {
  var ss = SpreadsheetApp.openById(rmRegistrationSpreadsheetId_());
  var registrationSheet = getRequiredSheet_(ss, rmRegistrationSheetName_());
  var contactSheet = getRequiredSheet_(ss, rmContactSheetName_());
  var registrationMap = ensureHeaderColumns_(registrationSheet, RM_REGISTRATION_COLUMN_SPEC);
  var contactMap = ensureHeaderColumns_(contactSheet, RM_CONTACT_COLUMN_SPEC);
  var report = {
    ok: true,
    spreadsheetId: ss.getId(),
    registrationSheet: registrationSheet.getName(),
    registrationHeaders: registrationMap,
    contactSheet: contactSheet.getName(),
    contactHeaders: contactMap,
    kakaoFriendUrl: RM_PASSPORT_CONFIG.KAKAO_FRIEND_URL,
    consentVersion: RM_PASSPORT_CONFIG.DAILY_TALK_CONSENT_VERSION,
    audience: getDailyTalkAudienceReport().activeCount
  };
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * Read-only header inspection for a spreadsheet that is too large to scan
 * interactively. Returns header names plus the resolved column map.
 */
function inspectPassportSheetHeaders() {
  var ss = SpreadsheetApp.openById(rmRegistrationSpreadsheetId_());
  var result = { ok: true, spreadsheetId: ss.getId(), sheets: {} };
  [rmRegistrationSheetName_(), rmContactSheetName_()].forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      result.sheets[name] = { exists: false };
      return;
    }
    var lastColumn = Math.max(sheet.getLastColumn(), 1);
    result.sheets[name] = {
      exists: true,
      lastRow: sheet.getLastRow(),
      lastColumn: lastColumn,
      headers: sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (header) {
        return String(header || '');
      })
    };
  });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/** Non-secret runtime facts, safe to log or show. */
function getPassportRuntimeStatus() {
  var properties = PropertiesService.getScriptProperties();
  return {
    ok: true,
    version: rmPassportVersion_(),
    spreadsheetId: rmRegistrationSpreadsheetId_(),
    registrationSheet: rmRegistrationSheetName_(),
    contactSheet: rmContactSheetName_(),
    consentVersion: RM_PASSPORT_CONFIG.DAILY_TALK_CONSENT_VERSION,
    hasSolapiKey: !!properties.getProperty('SOLAPI_API_KEY'),
    hasSolapiSecret: !!properties.getProperty('SOLAPI_API_SECRET'),
    hasWixKey: !!properties.getProperty('WIX_API_KEY'),
    hasOpenAiKey: !!properties.getProperty('OPENAI_API_KEY'),
    hasTestPhone: !!(properties.getProperty('TEST_PHONE') || properties.getProperty('TEST_OWNER_PHONE')),
    audience: getDailyTalkAudienceReport().activeCount,
    serverTime: nowIso_()
  };
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function rmRegistrationSpreadsheetId_() {
  return PropertiesService.getScriptProperties().getProperty('REGISTRATION_SPREADSHEET_ID') ||
    RM_PASSPORT_CONFIG.SPREADSHEET_ID;
}

function rmRegistrationSheetName_() {
  return PropertiesService.getScriptProperties().getProperty('REGISTRATION_SHEET') ||
    RM_PASSPORT_CONFIG.REGISTRATION_SHEET;
}

function rmContactSheetName_() {
  return PropertiesService.getScriptProperties().getProperty('CONTACT_SHEET') ||
    RM_PASSPORT_CONFIG.CONTACT_SHEET;
}

function rmDailyTalkOperationsSpreadsheetId_() {
  return PropertiesService.getScriptProperties().getProperty('DAILY_TALK_OPERATIONS_SPREADSHEET_ID') ||
    RM_PASSPORT_CONFIG.DAILY_TALK_OPERATIONS_SPREADSHEET_ID;
}

function rmPassportVersion_() {
  return '2026-11-18-go-live-1';
}

function nowIso_() {
  return new Date().toISOString();
}

function getRequiredSheet_(spreadsheet, name) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error("필수 시트 '" + name + "'를 찾을 수 없습니다.");
  return sheet;
}

function parseWebAppPayload_(e) {
  if (!e) return {};
  var content = e.postData && e.postData.contents ? e.postData.contents : '';
  if (content) {
    var parsed = safeJsonParse(content, null);
    if (parsed) return parsed;
  }
  return Object.assign({}, e.parameter || {});
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function logPassportError_(scope, error, context) {
  var message = error && error.message ? error.message : String(error);
  try {
    console.error('[english-passport] ' + scope + ': ' + message + ' ' + JSON.stringify(context || {}));
  } catch (ignored) { /* logging must never break a submission */ }
}
