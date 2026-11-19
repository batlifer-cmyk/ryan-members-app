/**
 * PassportCore.gs — pure, side-effect free logic for the English Passport and
 * Ryan Daily Talk pipeline.
 *
 * Rules for this file:
 *  - No SpreadsheetApp / PropertiesService / UrlFetchApp / HtmlService calls.
 *  - No Date.now() or other ambient state inside decision functions; the caller
 *    passes a timestamp when one is needed.
 *  - Every function here is exercised by tests/ in the repository with fixtures
 *    only, so a regression shows up without touching production Sheets.
 */

var RM_TRACKS = Object.freeze({
  SMALL_TALK: 'SMALL_TALK',
  BUSINESS: 'BUSINESS',
  BOTH: 'BOTH'
});

var RM_TRACK_LABELS = Object.freeze({
  SMALL_TALK: 'Daily Small Talk',
  BUSINESS: 'Daily Business Talk',
  BOTH: '두 콘텐츠 모두'
});

var RM_REGISTRATION_TYPES = Object.freeze(['신규등록', '재등록', '추가등록']);

var RM_DAILY_TALK_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  PAUSED: 'PAUSED'
});

var RM_SOLAPI_SUCCESS_CODE = 2000;
var RM_SOLAPI_PENDING_CODES = [3000, 3001, 3002];

/**
 * Normalizes a Korean mobile number to `010-XXXX-XXXX` (or the legacy prefix
 * layout for 011/016/017/018/019). Returns '' when the value cannot be a
 * Korean mobile number.
 */
function normalizePhone(value) {
  if (value === null || value === undefined) return '';
  // Full-width digits (common when numbers are pasted from Korean IMEs).
  var digits = String(value)
    .replace(/[\uFF10-\uFF19]/g, function (char) { return String.fromCharCode(char.charCodeAt(0) - 0xFEE0); })
    .replace(/[^0-9]/g, '');
  if (!digits) return '';

  // Country code forms: +82 10 1234 5678, 821012345678, 0082...
  if (digits.indexOf('0082') === 0) digits = digits.slice(4);
  else if (digits.indexOf('82') === 0 && digits.length >= 11) digits = digits.slice(2);
  if (digits.charAt(0) !== '0') digits = '0' + digits;

  if (digits.length === 11 && digits.slice(0, 3) === '010') {
    return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
  }
  // Legacy mobile prefixes kept in the school's older contact rows.
  if (digits.length === 10 && /^01[1-9]$/.test(digits.slice(0, 3))) {
    return digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6);
  }
  if (digits.length === 11 && /^01[1-9]$/.test(digits.slice(0, 3))) {
    return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
  }
  return '';
}

/** True when the value normalizes to a usable Korean mobile number. */
function isValidPhone(value) {
  return normalizePhone(value) !== '';
}

/** True only for the current 010 mobile prefix used by Daily Talk sends. */
function isDailyTalkPhone(value) {
  return /^010-\d{4}-\d{4}$/.test(normalizePhone(value));
}

/** `010-1234-5678` -> `***-****-5678`; never log a full number. */
function maskPhone(value) {
  var normalized = normalizePhone(value);
  if (!normalized) return '***';
  return '***-****-' + normalized.slice(-4);
}

/** Lenient boolean coercion for sheet cells and JSON payloads. */
function toBoolean(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === 'number') return value === 1;
  var text = String(value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'y' || text === 'yes' ||
    text === '동의' || text === '예';
}

/** Returns a canonical track or '' when the value is not one of the three. */
function normalizeTrack(value) {
  var text = String(value === null || value === undefined ? '' : value).trim().toUpperCase();
  if (text === 'SMALL_TALK' || text === 'SMALLTALK' || text === 'SMALL TALK') return RM_TRACKS.SMALL_TALK;
  if (text === 'BUSINESS' || text === 'BIZ') return RM_TRACKS.BUSINESS;
  if (text === 'BOTH' || text === 'ALL') return RM_TRACKS.BOTH;
  if (text === '두 콘텐츠 모두' || text === '둘다' || text === '모두') return RM_TRACKS.BOTH;
  return '';
}

/**
 * Course-based recommendation only. The student's explicit choice always
 * overrides this value (see resolveDailyTalkTrack).
 */
function classifyDailyTalkTrack(courseType) {
  var text = String(courseType === null || courseType === undefined ? '' : courseType)
    .toLowerCase()
    .replace(/\s+/g, ' ');

  var smallKeywords = ['일상회화', '여행영어', '여행 영어', '왕초보', '스몰톡', '스몰 톡',
    '사교영어', '영어입담', '발음', '억양', '울렁증', '쿠킹', '와인', '미술', '드로잉',
    '유화', '골프', '서핑', '게임', '커피챗', '네트워킹'];
  var businessKeywords = ['비즈니스', 'business', '직장인', '영어면접', '면접', '발표',
    '프레젠테이션', 'presentation', '교수임용', '영어강의', '피칭', 'ir 영어', '스타트업',
    '에세이', '라이팅', '아카데믹', '유학면접', '포트폴리오'];

  var hasSmall = smallKeywords.some(function (keyword) { return text.indexOf(keyword) !== -1; });
  var hasBusiness = businessKeywords.some(function (keyword) { return text.indexOf(keyword) !== -1; });

  if (hasSmall && hasBusiness) return RM_TRACKS.BOTH;
  if (hasBusiness) return RM_TRACKS.BUSINESS;
  return RM_TRACKS.SMALL_TALK;
}

/**
 * Final track resolution: the student's own choice wins; the course-based
 * recommendation is used only as a default when no valid choice exists.
 */
function resolveDailyTalkTrack(requestedTrack, courseType) {
  var chosen = normalizeTrack(requestedTrack);
  if (chosen) return chosen;
  return classifyDailyTalkTrack(courseType);
}

/**
 * Resolves the lesson count from the choice buttons plus the custom input.
 * `selected` is the pressed button value ('8', '16', ... or '직접 입력').
 */
function resolveLessonCount(selected, customValue) {
  var raw = String(selected === null || selected === undefined ? '' : selected).trim();
  var candidate = raw === '직접 입력' || raw === 'CUSTOM' || raw === 'custom'
    ? String(customValue === null || customValue === undefined ? '' : customValue).trim()
    : raw;
  var digits = candidate.replace(/[^0-9]/g, '');
  if (!digits) return 0;
  var count = parseInt(digits, 10);
  if (!isFinite(count)) return 0;
  return count;
}

/**
 * Normalizes a raw submission into the shape the storage layer expects.
 * `options.consentVersion` and `options.submittedAt` are supplied by the caller
 * so this stays pure and testable.
 */
function sanitizePassportPayload(input, options) {
  var source = input || {};
  var opts = options || {};
  var consentVersion = String(opts.consentVersion || '');
  var submittedAt = String(opts.submittedAt || '');
  var courseType = String(source.courseType === null || source.courseType === undefined ? '' : source.courseType).trim();
  var optIn = toBoolean(source.dailyTalkOptIn);
  var track = resolveDailyTalkTrack(source.dailyTalkTrack, courseType);
  var lessonCount = resolveLessonCount(
    source.lessonCount !== undefined && source.lessonCount !== null && source.lessonCount !== ''
      ? source.lessonCount
      : source.lessonCountChoice,
    source.lessonCountCustom
  );

  return {
    studentName: String(source.studentName === null || source.studentName === undefined ? '' : source.studentName).trim(),
    phone: normalizePhone(source.phone),
    phoneRaw: String(source.phone === null || source.phone === undefined ? '' : source.phone).trim(),
    registrationType: String(source.registrationType === null || source.registrationType === undefined ? '' : source.registrationType).trim(),
    lessonCount: lessonCount,
    courseType: courseType,
    teacher: String(source.teacher === null || source.teacher === undefined ? '' : source.teacher).trim(),
    learningGoal: String(source.learningGoal === null || source.learningGoal === undefined ? '' : source.learningGoal).trim(),
    privacyConsent: toBoolean(source.privacyConsent),
    dailyTalkOptIn: optIn,
    dailyTalkTrack: optIn ? track : '',
    dailyTalkTrackRecommendation: classifyDailyTalkTrack(courseType),
    dailyTalkTrackChosen: normalizeTrack(source.dailyTalkTrack) || '',
    dailyTalkConsentAt: optIn ? submittedAt : '',
    dailyTalkConsentVersion: optIn ? consentVersion : '',
    dailyTalkStatus: optIn ? RM_DAILY_TALK_STATUS.ACTIVE : RM_DAILY_TALK_STATUS.INACTIVE,
    // A click on the channel button is not a confirmed Kakao friend add.
    kakaoChannelAdded: false,
    lastDailyTalkSentAt: '',
    userAgent: String(source.userAgent === null || source.userAgent === undefined ? '' : source.userAgent).slice(0, 500),
    submittedAt: submittedAt
  };
}

/**
 * Validates a sanitized payload. Returns a result object instead of throwing so
 * the same rules can be unit tested and reused by doPost.
 */
function validatePassportPayload(payload) {
  var errors = [];
  var value = payload || {};

  if (!value.studentName) {
    errors.push({ field: 'studentName', message: '학생명을 입력해 주세요.' });
  } else if (value.studentName.length > 40) {
    errors.push({ field: 'studentName', message: '학생명이 너무 깁니다.' });
  }

  if (!value.phone) {
    errors.push({ field: 'phone', message: '휴대전화번호를 정확히 입력해 주세요.' });
  }

  if (RM_REGISTRATION_TYPES.indexOf(value.registrationType) === -1) {
    errors.push({ field: 'registrationType', message: '등록 구분을 선택해 주세요.' });
  }

  var lessonCount = Number(value.lessonCount);
  if (!isFinite(lessonCount) || Math.floor(lessonCount) !== lessonCount || lessonCount < 1 || lessonCount > 300) {
    errors.push({ field: 'lessonCount', message: '등록 회차는 1회부터 300회 사이여야 합니다.' });
  }

  if (!value.courseType) {
    errors.push({ field: 'courseType', message: '등록 과목을 선택해 주세요.' });
  } else if (value.courseType.length > 120) {
    errors.push({ field: 'courseType', message: '등록 과목이 너무 깁니다.' });
  }

  if (!value.learningGoal) {
    errors.push({ field: 'learningGoal', message: '학습 목표를 선택해 주세요.' });
  }

  if (value.teacher && value.teacher.length > 40) {
    errors.push({ field: 'teacher', message: '담당 강사 이름이 너무 깁니다.' });
  }

  if (!value.privacyConsent) {
    errors.push({ field: 'privacyConsent', message: '개인정보 수집·이용 동의가 필요합니다.' });
  }

  if (value.dailyTalkOptIn !== true) {
    // Opting out is legitimate: no track requirement at all.
    if (value.dailyTalkTrack) {
      errors.push({ field: 'dailyTalkTrack', message: '수신에 동의하지 않으면 트랙을 저장하지 않습니다.' });
    }
  } else if (!normalizeTrack(value.dailyTalkTrack)) {
    errors.push({ field: 'dailyTalkTrack', message: '받을 Daily Talk를 선택해 주세요.' });
  }

  if (value.dailyTalkOptIn === true && !value.dailyTalkConsentVersion) {
    errors.push({ field: 'dailyTalkConsentVersion', message: '수신동의 버전이 없습니다.' });
  }

  if (value.kakaoChannelAdded === true) {
    errors.push({ field: 'kakaoChannelAdded', message: '카카오 채널 추가 여부는 콜백으로만 기록합니다.' });
  }

  return { ok: errors.length === 0, errors: errors, value: value };
}

/** Flat canonical field values for one `_DB_등록신청` row. */
function buildRegistrationFields(payload, meta) {
  var value = payload || {};
  var info = meta || {};
  var submissionId = String(info.submissionId || '');
  var nowIso = String(info.nowIso || value.submittedAt || '');
  var sourceJson = JSON.stringify({
    studentName: value.studentName,
    phone: value.phone,
    registrationType: value.registrationType,
    lessonCount: value.lessonCount,
    courseType: value.courseType,
    teacher: value.teacher,
    learningGoal: value.learningGoal,
    privacyConsent: value.privacyConsent,
    dailyTalkOptIn: value.dailyTalkOptIn,
    dailyTalkTrack: value.dailyTalkTrack,
    dailyTalkTrackChosen: value.dailyTalkTrackChosen,
    dailyTalkConsentAt: value.dailyTalkConsentAt,
    dailyTalkConsentVersion: value.dailyTalkConsentVersion,
    userAgent: value.userAgent,
    serverTimestamp: nowIso
  });

  return {
    '제출ID': submissionId,
    '제출일시': nowIso,
    '학생명': value.studentName,
    '전화번호': value.phone,
    '등록구분': value.registrationType,
    '신청회차': value.lessonCount,
    '수업유형': value.courseType,
    '담당강사': value.teacher,
    '학습목표': value.learningGoal,
    '개인정보동의': '동의',
    '제출경로': '영어여권웹',
    '학생매칭상태': '대기',
    '결제매칭상태': '대기',
    '처리상태': '접수',
    '등록로그ID': '',
    '원본요청JSON': sourceJson,
    'dailyTalkOptIn': value.dailyTalkOptIn === true,
    'dailyTalkTrack': value.dailyTalkTrack,
    'dailyTalkConsentAt': value.dailyTalkConsentAt,
    'dailyTalkConsentVersion': value.dailyTalkConsentVersion,
    'kakaoChannelAdded': false,
    'dailyTalkStatus': value.dailyTalkStatus,
    'lastDailyTalkSentAt': ''
  };
}

/** Flat canonical field values for one `학생연락처` row update. */
function buildContactFields(payload) {
  var value = payload || {};
  return {
    '학생명': value.studentName,
    '전화번호': value.phone,
    'dailyTalkOptIn': value.dailyTalkOptIn === true,
    'dailyTalkTrack': value.dailyTalkTrack,
    'dailyTalkConsentAt': value.dailyTalkConsentAt,
    'dailyTalkConsentVersion': value.dailyTalkConsentVersion,
    'kakaoChannelAdded': false,
    'dailyTalkStatus': value.dailyTalkStatus,
    'lastDailyTalkSentAt': ''
  };
}

/**
 * Maps header labels to column numbers (1-based) using alias lists.
 * `spec` is an array of { field, aliases, required, defaultValue }.
 * Missing optional fields are appended after `lastColumn`.
 */
function resolveColumnMap(headers, spec, options) {
  var opts = options || {};
  var createMissing = opts.createMissing !== false;
  var normalizedHeaders = (headers || []).map(function (header) {
    return String(header === null || header === undefined ? '' : header).trim();
  });
  var map = {};
  var missing = [];
  var appendIndex = normalizedHeaders.length + 1;

  (spec || []).forEach(function (entry) {
    // Candidate names are tried in priority order (most specific first), not in
    // sheet column order: `최종전화번호` must beat a generic `전화번호` column.
    var candidates = (entry.aliases || []).concat([entry.field]);
    var found = 0;
    for (var c = 0; c < candidates.length && !found; c += 1) {
      var candidate = String(candidates[c]).toLowerCase();
      for (var i = 0; i < normalizedHeaders.length; i += 1) {
        if (normalizedHeaders[i].toLowerCase() === candidate) { found = i + 1; break; }
      }
    }
    if (found) {
      map[entry.field] = found;
    } else if (entry.required || createMissing) {
      map[entry.field] = appendIndex;
      normalizedHeaders.push(entry.field);
      appendIndex += 1;
      missing.push(entry.field);
    }
  });

  return { map: map, missing: missing, headerCount: normalizedHeaders.length, appendedHeaders: missing };
}

/** Builds a full row array (1-based index -> value) from a field map. */
function buildRowValues(fieldMap, fields, maxColumn) {
  var width = maxColumn || 0;
  Object.keys(fieldMap || {}).forEach(function (field) {
    if (fieldMap[field] > width) width = fieldMap[field];
  });
  var row = [];
  for (var i = 0; i < width; i += 1) row.push('');
  Object.keys(fields || {}).forEach(function (field) {
    var column = fieldMap[field];
    if (!column) return;
    row[column - 1] = fields[field];
  });
  return row;
}

/**
 * Filters raw contact records down to the Daily Talk audience.
 * `records` items: { rowNumber, name, phone, optIn, track, status, lastSentAt }
 */
function filterActiveRecipients(records) {
  var accepted = [];
  var rejected = [];
  var seen = {};

  (records || []).forEach(function (record) {
    var row = record || {};
    var name = String(row.name === null || row.name === undefined ? '' : row.name).trim();
    var phone = normalizePhone(row.phone);
    var track = normalizeTrack(row.track) || RM_TRACKS.SMALL_TALK;
    var optIn = toBoolean(row.optIn);
    var status = String(row.status === null || row.status === undefined ? '' : row.status).trim().toUpperCase();

    if (!phone) {
      rejected.push({ rowNumber: row.rowNumber, phone: String(row.phone || ''), reason: 'INVALID_PHONE' });
      return;
    }
    if (!isDailyTalkPhone(phone)) {
      rejected.push({ rowNumber: row.rowNumber, phone: phone, reason: 'NOT_MOBILE_010' });
      return;
    }
    if (!optIn) {
      rejected.push({ rowNumber: row.rowNumber, phone: phone, reason: 'NOT_OPTED_IN' });
      return;
    }
    if (status !== RM_DAILY_TALK_STATUS.ACTIVE) {
      rejected.push({ rowNumber: row.rowNumber, phone: phone, reason: 'STATUS_' + (status || 'EMPTY') });
      return;
    }
    if (!name) {
      rejected.push({ rowNumber: row.rowNumber, phone: phone, reason: 'MISSING_NAME' });
      return;
    }
    if (seen[phone]) {
      rejected.push({ rowNumber: row.rowNumber, phone: phone, reason: 'DUPLICATE_PHONE' });
      return;
    }
    seen[phone] = true;
    accepted.push({
      rowNumber: row.rowNumber,
      name: name,
      phone: phone,
      track: track,
      lastDailyTalkSentAt: row.lastSentAt || ''
    });
  });

  return { recipients: accepted, rejected: rejected };
}

/** Recipients that should receive the given track. `BOTH` gets each track. */
function selectRecipientsForTrack(recipients, track) {
  var normalized = normalizeTrack(track) || RM_TRACKS.SMALL_TALK;
  return (recipients || []).filter(function (recipient) {
    if (!recipient) return false;
    var recipientTrack = normalizeTrack(recipient.track) || RM_TRACKS.SMALL_TALK;
    if (recipientTrack === RM_TRACKS.BOTH) return true;
    return recipientTrack === normalized;
  });
}

/** Idempotency key for one content item delivered to one phone number. */
function buildSendKey(contentId, phone) {
  var id = String(contentId === null || contentId === undefined ? '' : contentId).trim();
  var normalized = normalizePhone(phone);
  return id + '|' + normalized;
}

/**
 * `alreadySentKeys` arrives either as an array of send keys (tests, callers that
 * build their own list) or as the key map returned by readSendLogIndex_. Both
 * shapes mean the same thing: these contentId+phone pairs are already sent.
 */
function normalizeAlreadySentKeys_(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Object.keys(value).filter(function (key) { return value[key]; });
}

/**
 * Plans a single run.
 * items: [{ contentId, track, targets:[{name,phone,track}], alreadySentKeys:[] }]
 * Output targets are unique per contentId+phone so a `BOTH` recipient receives
 * each track once and never the same content twice.
 */
function buildSendPlan(items, options) {
  var opts = options || {};
  var limit = typeof opts.maxRecipients === 'number' && opts.maxRecipients > 0 ? opts.maxRecipients : 300;
  var targets = [];
  var skipped = [];
  var usedKeys = {};

  (items || []).forEach(function (item) {
    var contentId = String(item && item.contentId ? item.contentId : '').trim();
    var alreadySent = {};
    normalizeAlreadySentKeys_(item && item.alreadySentKeys).forEach(function (key) { alreadySent[key] = true; });
    var track = normalizeTrack(item && item.track) || RM_TRACKS.SMALL_TALK;
    var list = selectRecipientsForTrack((item && item.targets) || [], track);

    list.forEach(function (recipient) {
      var phone = normalizePhone(recipient.phone);
      if (!phone) {
        skipped.push({ contentId: contentId, phone: '', reason: 'INVALID_PHONE' });
        return;
      }
      var key = buildSendKey(contentId, phone);
      if (alreadySent[key]) {
        skipped.push({ contentId: contentId, phone: phone, reason: 'ALREADY_SENT' });
        return;
      }
      if (usedKeys[key]) {
        skipped.push({ contentId: contentId, phone: phone, reason: 'DUPLICATE_IN_RUN' });
        return;
      }
      if (targets.length >= limit) {
        skipped.push({ contentId: contentId, phone: phone, reason: 'RECIPIENT_LIMIT' });
        return;
      }
      usedKeys[key] = true;
      targets.push({
        contentId: contentId,
        track: track,
        name: String(recipient.name || '').trim(),
        phone: phone,
        key: key
      });
    });
  });

  return { targets: targets, skipped: skipped };
}

/** Builds the send-log lookup key set from log rows `{ contentId, phone }`. */
function buildAlreadySentKeySet(logRows) {
  var set = {};
  (logRows || []).forEach(function (row) {
    if (!row) return;
    var status = String(row.status || '').toUpperCase();
    if (status && status !== 'SENT' && status !== 'ACCEPTED' && status !== 'SUCCESS') return;
    var key = buildSendKey(row.contentId, row.phone);
    if (key !== '|') set[key] = true;
  });
  return set;
}

/**
 * Parses a SOLAPI send response into per-recipient outcomes.
 * Only statusCode 2000 counts as accepted; anything else is a failure so the
 * pipeline never marks an undelivered message as sent.
 *
 * SOLAPI does not always echo the recipient number back: the real send-many
 * response carries messageId/statusCode/customFields but no `to`. When no entry
 * in the response has a recipient and the entry count matches the number of
 * recipients we sent, the entries are paired with the send order instead. Any
 * other mismatch stays unverified rather than being guessed.
 */
function parseSolapiResponse(response, expectedPhones) {
  var parsed = typeof response === 'string' ? safeJsonParse(response, {}) : (response || {});
  var list = parsed.messageList || parsed.messages || [];
  var expected = (expectedPhones || []).map(normalizePhone).filter(Boolean);
  var results = [];
  var seen = {};

  if (!Array.isArray(list) || list.length === 0) {
    var group = parsed.groupInfo || {};
    var count = group.count || {};
    return {
      verified: false,
      results: expected.map(function (phone) {
        return { phone: phone, status: 'UNVERIFIED', ok: false, messageId: '', reason: 'NO_MESSAGE_LIST' };
      }),
      groupId: String(group._id || group.groupId || ''),
      registeredSuccess: Number(count.registeredSuccess || 0),
      registeredFailed: Number(count.registeredFailed || 0)
    };
  }

  var entryPhones = list.map(function (entry) {
    return normalizePhone(entry && (entry.to || entry.phone));
  });
  var hasRecipientField = entryPhones.some(function (phone) { return !!phone; });
  var pairByIndex = !hasRecipientField && list.length === expected.length;

  list.forEach(function (entry, index) {
    var phone = entryPhones[index] || (pairByIndex ? expected[index] : '');
    if (!phone) return;
    var statusCode = Number(entry.statusCode);
    var messageId = String(entry.messageId || entry._id || '');
    var status = String(entry.status || '');
    var ok = statusCode === RM_SOLAPI_SUCCESS_CODE;
    var pending = RM_SOLAPI_PENDING_CODES.indexOf(statusCode) !== -1;
    seen[phone] = true;
    results.push({
      phone: phone,
      ok: ok,
      pending: pending,
      status: ok ? 'SENT' : (pending ? 'PENDING' : 'FAILED'),
      statusCode: statusCode,
      messageId: messageId,
      reason: ok ? '' : String(entry.statusMessage || entry.reason || status || 'SOLAPI_' + statusCode)
    });
  });

  expected.forEach(function (phone) {
    if (seen[phone]) return;
    results.push({ phone: phone, ok: false, status: 'FAILED', statusCode: 0, messageId: '', reason: 'NOT_IN_RESPONSE' });
  });

  var groupInfo = parsed.groupInfo || {};
  return {
    verified: true,
    results: results,
    groupId: String(groupInfo._id || groupInfo.groupId || ''),
    pairedByIndex: pairByIndex,
    registeredSuccess: null,
    registeredFailed: null
  };
}

/** Accepts only an absolute http(s) Wix post URL (blog post or magazine item). */
function isValidWixPostUrl(url) {
  var text = String(url === null || url === undefined ? '' : url).trim();
  if (!/^https?:\/\/[^\s]+$/i.test(text)) return false;
  if (!/^https?:\/\/(www\.)?ryanmembers\.com\//i.test(text)) return false;
  if (/\/blog\/categories\/daily-talk\/?$/i.test(text)) return false; // category page is not a post
  if (/\/rm-magazine\/?([?#].*)?$/i.test(text)) return false; // magazine index is not a post
  return true;
}

/** Kakao Brand Message body: advert label, title, link, opt-out footer. */
function buildKakaoMessageText(item, footer) {
  var value = item || {};
  var title = String(value.topicKo || value.topicEn || '오늘의 영어').trim();
  var url = String(value.wixContentUrl || '').trim();
  var footerText = String(footer || '수신거부: 카카오톡에서 라이언멤버스 채널을 차단해 주세요.').trim();
  var lines = [
    '(광고) 라이언멤버스 Ryan Daily Talk',
    title,
    '',
    '오늘의 영어 표현과 말하기 미션을 확인하세요.'
  ];
  if (url) lines.push(url);
  lines.push('');
  lines.push(footerText);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Daily Talk only (standalone sign-up / track change)
// ---------------------------------------------------------------------------

/**
 * Consent text for the standalone Daily Talk page (`?dailytalk=1`).
 *
 * It is the English Passport consent without the "영어여권 발급 후" clause,
 * because this page is also opened by visitors who never issued a passport
 * (and by existing subscribers who only change their track). The wording is
 * otherwise identical, and it keeps its own version so the sheet shows which
 * surface the consent was given on.
 */
var RM_DAILY_TALK_ONLY_CONSENT_TEXT = '라이언멤버스의 평일 영어 학습 콘텐츠를 카카오톡으로 받겠습니다. 광고성 정보 수신에 동의하며, 카카오톡 채널 차단을 통해 언제든 중단할 수 있습니다.';
var RM_DAILY_TALK_ONLY_CONSENT_VERSION = '2026-11-20-dailytalk-only-v1';

/** Normalizes one standalone Daily Talk submission (pure). */
function sanitizeDailyTalkOnlyPayload(input, options) {
  var source = input || {};
  var opts = options || {};
  var submittedAt = String(opts.submittedAt || '');
  var consent = toBoolean(source.dailyTalkConsent) || toBoolean(source.consent);

  return {
    studentName: String(source.studentName === null || source.studentName === undefined ? '' : source.studentName).trim(),
    phone: normalizePhone(source.phone),
    phoneRaw: String(source.phone === null || source.phone === undefined ? '' : source.phone).trim(),
    dailyTalkTrack: normalizeTrack(source.dailyTalkTrack),
    dailyTalkOptIn: consent,
    dailyTalkConsentAt: consent ? submittedAt : '',
    dailyTalkConsentVersion: consent ? String(opts.consentVersion || '') : '',
    dailyTalkStatus: consent ? RM_DAILY_TALK_STATUS.ACTIVE : RM_DAILY_TALK_STATUS.INACTIVE,
    source: 'DAILY_TALK_ONLY',
    userAgent: String(source.userAgent === null || source.userAgent === undefined ? '' : source.userAgent).slice(0, 500),
    submittedAt: submittedAt
  };
}

/** Validates a sanitized standalone submission. */
function validateDailyTalkOnlyPayload(payload) {
  var errors = [];
  var value = payload || {};

  if (!value.studentName) {
    errors.push({ field: 'studentName', message: '이름을 입력해 주세요.' });
  } else if (value.studentName.length > 40) {
    errors.push({ field: 'studentName', message: '이름이 너무 깁니다.' });
  }

  if (!value.phone) {
    errors.push({ field: 'phone', message: '휴대폰 번호를 정확히 입력해 주세요.' });
  } else if (!isDailyTalkPhone(value.phone)) {
    errors.push({ field: 'phone', message: '010으로 시작하는 휴대폰 번호를 입력해 주세요.' });
  }

  if (!normalizeTrack(value.dailyTalkTrack)) {
    errors.push({ field: 'dailyTalkTrack', message: '받을 Daily Talk를 선택해 주세요.' });
  }

  if (value.dailyTalkOptIn !== true) {
    errors.push({ field: 'dailyTalkConsent', message: '카카오톡 수신에 동의해 주세요.' });
  }

  if (value.dailyTalkOptIn === true && !value.dailyTalkConsentVersion) {
    errors.push({ field: 'dailyTalkConsentVersion', message: '수신동의 버전이 없습니다.' });
  }

  return { ok: errors.length === 0, errors: errors, value: value };
}

/**
 * The only cells a standalone submission may write, built from the row that is
 * already in `학생연락처`.
 *
 * Everything else on that row (등록상태, 수업 정보, 메모, 카카오 친구 추가
 * 확인, 마지막 발송일 …) is left exactly as it is: the writer only touches the
 * keys returned here. A non-empty student name is never replaced, so a track
 * change cannot rename a student by a typo in this small form.
 */
function buildDailyTalkOnlyContactFields(payload, existing) {
  var value = payload || {};
  var current = existing || {};
  var currentName = String(current.studentName === null || current.studentName === undefined ? '' : current.studentName).trim();
  var submittedName = String(value.studentName || '').trim();

  var fields = {
    'dailyTalkOptIn': value.dailyTalkOptIn === true,
    'dailyTalkTrack': normalizeTrack(value.dailyTalkTrack),
    'dailyTalkConsentAt': value.dailyTalkConsentAt,
    'dailyTalkConsentVersion': value.dailyTalkConsentVersion,
    'dailyTalkStatus': value.dailyTalkOptIn === true ? RM_DAILY_TALK_STATUS.ACTIVE : RM_DAILY_TALK_STATUS.INACTIVE
  };
  if (!currentName) fields['학생명'] = submittedName;

  return {
    fields: fields,
    storedName: currentName || submittedName,
    nameKept: !!currentName && currentName !== submittedName
  };
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallback;
  }
}

/** Collapses whitespace so exact-copy checks do not fail on formatting. */
function normalizeWhitespace(text) {
  return String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
}
