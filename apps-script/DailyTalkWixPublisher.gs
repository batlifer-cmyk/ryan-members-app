const RM_DAILY_TALK_CONFIG = Object.freeze({
  OPERATIONS_SPREADSHEET_ID: '1vpPKVhDOj9Np5RL-Afu7vTHTqm4gfG3M5MCqkWmUeDE',
  SETTINGS_SHEET: '설정',
  QUEUE_SHEET: '콘텐츠대기열',
  LOG_SHEET: '발송로그',
  QUEUE_HEADER_ROW: 3,
  WIX_SITE_ID: '77af5a69-40e6-48a1-a727-03aee59a6da4',
  WIX_CONTENT_COLLECTION_ID: 'RyanDailyTalkContent',
  WIX_MAGAZINE_BASE_URL: 'https://www.ryanmembers.com/rm-magazine',
  WIX_CATEGORY_ID: '736b3232-2c06-4ff8-bf2d-970a5d838cba',
  WIX_MEMBER_ID: '13661272-2b5b-f6ec-d5dc-e8caa85bc8a6',
  WIX_CATEGORY_URL: 'https://www.ryanmembers.com/blog/categories/daily-talk',
  SOLAPI_SEND_URL: 'https://api.solapi.com/messages/v4/send-many/detail'
});

/**
 * Main weekday pipeline:
 * 1. Publish APPROVED queue rows to the RM Magazine CMS collection.
 * 2. Send the RM Magazine URL to ACTIVE English Passport recipients by Kakao Brand Message.
 *
 * Required Script Properties:
 * - WIX_API_KEY
 * - SOLAPI_API_KEY
 * - SOLAPI_API_SECRET
 *
 * Required Settings value:
 * - SOLAPI_PF_ID
 */
function runDailyTalkWixAndKakaoPipeline() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(RM_DAILY_TALK_CONFIG.OPERATIONS_SPREADSHEET_ID);
    const settings = loadDailyTalkSettings_(ss);
    const queue = getDailyTalkSheet_(ss, RM_DAILY_TALK_CONFIG.QUEUE_SHEET);
    const rows = readQueueRows_(queue);
    const results = [];

    rows.forEach(item => {
      if (item.status !== 'APPROVED') return;
      try {
        if (!item.wixContentUrl) {
          const published = publishDailyTalkToWix_(item, settings);
          writeQueuePublishingResult_(queue, item.rowNumber, published);
          item.wixContentUrl = published.url;
          item.wixPostId = published.postId;
          item.wixPublishedAt = published.publishedAt;
        }

        if (!item.kakaoLinkSentAt) {
          const sent = sendDailyTalkWixLink_(item, settings);
          writeQueueSendResult_(queue, item.rowNumber, sent);
          results.push({contentId: item.contentId, ok: true, ...sent});
        }
      } catch (error) {
        writeQueueFailure_(queue, item.rowNumber, error);
        results.push({contentId: item.contentId, ok: false, error: error.message || String(error)});
      }
    });

    return {ok: true, processed: results.length, results};
  } finally {
    lock.releaseLock();
  }
}

function publishDailyTalkToWix_(item, settings) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('WIX_API_KEY');
  if (!apiKey) throw new Error('Script Properties에 WIX_API_KEY가 없습니다.');

  const collectionId = String(settings.WIX_CMS_COLLECTION_ID || RM_DAILY_TALK_CONFIG.WIX_CONTENT_COLLECTION_ID).trim();
  const slug = makeDailyTalkSlug_(item);
  const url = buildMagazineUrl_(slug, settings);
  const title = `[${item.track === 'BUSINESS' ? 'Business Talk' : 'Small Talk'}] ${item.topicKo || item.topicEn || item.contentId}`;
  const data = buildDailyTalkCmsData_(item, title, slug, url);
  const existing = findWixDataItemBySlug_(apiKey, settings, collectionId, slug);
  const saved = existing
    ? updateWixDataItem_(apiKey, settings, collectionId, existing.id, data)
    : insertWixDataItem_(apiKey, settings, collectionId, data);

  return {
    postId: saved.id || '',
    url,
    publishedAt: new Date()
  };
}

function buildDailyTalkCmsData_(item, title, slug, magazineUrl) {
  return {
    contentId: String(item.contentId || ''),
    title,
    slug,
    track: String(item.track || 'SMALL_TALK'),
    level: String(item.level || 'BASIC'),
    publishDate: formatDateForWix_(item.sendDate || new Date()),
    status: 'PUBLISHED',
    topicEn: String(item.topicEn || ''),
    topicKo: String(item.topicKo || ''),
    snackEn: String(item.snackEn || ''),
    snackKo: String(item.snackKo || ''),
    chunksJson: String(item.chunksJson || ''),
    modelAnswerEn: String(item.modelEn || ''),
    modelAnswerKo: String(item.modelKo || ''),
    yourTurnEn: String(item.yourTurnEn || ''),
    yourTurnKo: String(item.yourTurnKo || ''),
    sourceUrls: parseSourceUrls_(item.sources),
    blogPostId: '',
    blogUrl: '',
    magazineUrl,
    contentHtml: buildDailyTalkContentHtml_(item),
    kakaoText: buildDailyTalkKakaoText_({...item, wixContentUrl: magazineUrl}),
    generatedByAi: true
  };
}

function buildDailyTalkContentHtml_(item) {
  const parts = [];
  if (item.topicEn) parts.push(`<h2>${escapeHtml_(item.topicEn)}</h2>`);
  if (item.topicKo) parts.push(`<p class="topic-ko">${escapeHtml_(item.topicKo)}</p>`);
  if (item.snackEn || item.snackKo) parts.push('<h3>Today&rsquo;s Language Snack</h3>');
  if (item.snackEn) parts.push(`<p>${escapeHtml_(item.snackEn)}</p>`);
  if (item.snackKo) parts.push(`<p>${escapeHtml_(item.snackKo)}</p>`);
  const chunks = parseChunks_(item.chunksJson);
  if (chunks.length) {
    parts.push('<h3>Useful Chunks</h3>');
    parts.push('<ul>');
    chunks.forEach(chunk => {
      if (typeof chunk === 'string') {
        parts.push(`<li>${escapeHtml_(chunk)}</li>`);
      } else {
        const en = escapeHtml_(chunk.en || chunk.expression || JSON.stringify(chunk));
        const ko = chunk.ko ? ` <span>${escapeHtml_(chunk.ko)}</span>` : '';
        parts.push(`<li><strong>${en}</strong>${ko}</li>`);
      }
    });
    parts.push('</ul>');
  }
  if (item.modelEn || item.modelKo) parts.push('<h3>Model Answer</h3>');
  if (item.modelEn) parts.push(`<p>${escapeHtml_(item.modelEn)}</p>`);
  if (item.modelKo) parts.push(`<p>${escapeHtml_(item.modelKo)}</p>`);
  if (item.yourTurnEn || item.yourTurnKo) parts.push('<h3>Your Turn</h3>');
  if (item.yourTurnEn) parts.push(`<p>${escapeHtml_(item.yourTurnEn)}</p>`);
  if (item.yourTurnKo) parts.push(`<p>${escapeHtml_(item.yourTurnKo)}</p>`);
  parts.push('<p class="rm-signature">Ryan Members · English Opens a New World.</p>');
  return parts.join('\\n');
}

function sendDailyTalkWixLink_(item, settings) {
  const recipients = getActiveDailyTalkRecipients().filter(recipient => {
    if (item.track === 'BUSINESS') return recipient.track === 'BUSINESS' || recipient.track === 'BOTH';
    return recipient.track === 'SMALL_TALK' || recipient.track === 'BOTH';
  });

  const maxRecipients = Number(settings.MAX_RECIPIENTS_PER_RUN || 300);
  let targets = recipients.slice(0, maxRecipients);
  if (toDailyTalkBoolean_(settings.TEST_MODE)) {
    const testPhone = normalizeDailyTalkPhone_(settings.TEST_PHONE);
    if (!/^010-\d{4}-\d{4}$/.test(testPhone)) {
      throw new Error('TEST_MODE=TRUE이면 설정 시트의 TEST_PHONE에 010-0000-0000 형식의 테스트 번호가 필요합니다.');
    }
    const matched = recipients.find(recipient => normalizeDailyTalkPhone_(recipient.phone) === testPhone);
    targets = [{
      sourceRow: matched ? matched.sourceRow : '',
      studentName: matched ? matched.studentName : 'TEST_RECIPIENT',
      phone: testPhone,
      track: matched ? matched.track : (item.track === 'BUSINESS' ? 'BUSINESS' : 'SMALL_TALK'),
      lastDailyTalkSentAt: matched ? matched.lastDailyTalkSentAt : ''
    }];
  }
  if (!targets.length) {
    return {sentCount: 0, failedCount: 0, sentAt: new Date(), reason: 'NO_ACTIVE_RECIPIENTS'};
  }

  const pfId = String(settings.SOLAPI_PF_ID || '').trim();
  if (!pfId || pfId.indexOf('...') !== -1) throw new Error('설정 시트의 SOLAPI_PF_ID가 실제 값으로 입력되지 않았습니다.');

  const text = buildDailyTalkKakaoText_(item);
  const messages = targets.map(recipient => ({
    to: recipient.phone.replace(/\D/g, ''),
    text,
    kakaoOptions: {
      pfId,
      disableSms: true,
      bms: {
        targeting: String(settings.BMS_TARGETING || 'I'),
        chatBubbleType: 'TEXT',
        adult: false,
        buttons: [{
          name: '오늘의 영어 열기',
          linkType: 'WL',
          linkMobile: item.wixContentUrl,
          linkPc: item.wixContentUrl
        }]
      }
    },
    customFields: {
      contentId: item.contentId,
      track: item.track,
      source: 'ENGLISH_PASSPORT'
    }
  }));

  const result = callSolapi_(messages);
  const sentAt = new Date();
  targets.forEach(recipient => markDailyTalkSent(recipient.phone, sentAt));
  appendDailyTalkSendLogs_(targets, item, result, sentAt);

  return {
    sentCount: targets.length,
    failedCount: 0,
    sentAt,
    response: result
  };
}

function buildDailyTalkKakaoText_(item) {
  const title = item.topicKo || item.topicEn || '오늘의 영어';
  return [
    '(광고) 라이언멤버스 Ryan Daily Talk',
    title,
    '',
    '오늘의 영어 표현과 말하기 미션을 확인하세요.',
    item.wixContentUrl,
    '',
    '수신거부: 카카오톡에서 라이언멤버스 채널을 차단해 주세요.'
  ].join('\n');
}

function callSolapi_(messages) {
  const properties = PropertiesService.getScriptProperties();
  const apiKey = properties.getProperty('SOLAPI_API_KEY');
  const apiSecret = properties.getProperty('SOLAPI_API_SECRET');
  if (!apiKey || !apiSecret) throw new Error('Script Properties에 SOLAPI_API_KEY 또는 SOLAPI_API_SECRET이 없습니다.');

  const response = UrlFetchApp.fetch(RM_DAILY_TALK_CONFIG.SOLAPI_SEND_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {Authorization: createSolapiAuthHeader_(apiKey, apiSecret)},
    payload: JSON.stringify({
      messages,
      strict: false,
      allowDuplicates: false,
      showMessageList: true
    }),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error(`SOLAPI 발송 실패 (${status}): ${text.slice(0, 700)}`);
  }
  return JSON.parse(text);
}

function createSolapiAuthHeader_(apiKey, apiSecret) {
  const dateTime = new Date().toISOString();
  const salt = Utilities.getUuid().replace(/-/g, '');
  const signatureBytes = Utilities.computeHmacSha256Signature(dateTime + salt, apiSecret);
  const signature = signatureBytes.map(byte => {
    const unsigned = byte < 0 ? byte + 256 : byte;
    return ('0' + unsigned.toString(16)).slice(-2);
  }).join('');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${dateTime}, salt=${salt}, signature=${signature}`;
}

function readQueueRows_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow <= RM_DAILY_TALK_CONFIG.QUEUE_HEADER_ROW) return [];
  const headers = sheet.getRange(RM_DAILY_TALK_CONFIG.QUEUE_HEADER_ROW, 1, 1, lastColumn).getDisplayValues()[0];
  const headerMap = {};
  headers.forEach((header, index) => { if (header) headerMap[header] = index; });
  const values = sheet.getRange(RM_DAILY_TALK_CONFIG.QUEUE_HEADER_ROW + 1, 1, lastRow - RM_DAILY_TALK_CONFIG.QUEUE_HEADER_ROW, lastColumn).getValues();

  return values.map((row, index) => ({
    rowNumber: index + RM_DAILY_TALK_CONFIG.QUEUE_HEADER_ROW + 1,
    contentId: cell_(row, headerMap, 'CONTENT_ID'),
    sendDate: cell_(row, headerMap, '발송일'),
    track: String(cell_(row, headerMap, '트랙') || 'SMALL_TALK'),
    level: cell_(row, headerMap, '레벨'),
    status: String(cell_(row, headerMap, '상태') || ''),
    topicEn: cell_(row, headerMap, 'TOPIC_EN'),
    topicKo: cell_(row, headerMap, 'TOPIC_KO'),
    snackEn: cell_(row, headerMap, 'SNACK_EN'),
    snackKo: cell_(row, headerMap, 'SNACK_KO'),
    chunksJson: cell_(row, headerMap, 'CHUNKS_JSON'),
    modelEn: cell_(row, headerMap, 'MODEL_EN'),
    modelKo: cell_(row, headerMap, 'MODEL_KO'),
    yourTurnEn: cell_(row, headerMap, 'YOUR_TURN_EN'),
    yourTurnKo: cell_(row, headerMap, 'YOUR_TURN_KO'),
    sources: cell_(row, headerMap, 'SOURCES'),
    wixContentUrl: cell_(row, headerMap, 'WIX_CONTENT_URL'),
    wixPostId: cell_(row, headerMap, 'WIX_POST_ID'),
    wixPublishedAt: cell_(row, headerMap, 'WIX_PUBLISHED_AT'),
    kakaoLinkSentAt: cell_(row, headerMap, 'KAKAO_LINK_SENT_AT')
  })).filter(item => item.contentId);
}

function writeQueuePublishingResult_(sheet, rowNumber, published) {
  const map = queueHeaderMap_(sheet);
  setHeaderCell_(sheet, rowNumber, map, 'WIX_CONTENT_URL', published.url);
  setHeaderCell_(sheet, rowNumber, map, 'WIX_POST_ID', published.postId);
  setHeaderCell_(sheet, rowNumber, map, 'WIX_PUBLISHED_AT', published.publishedAt);
  setHeaderCell_(sheet, rowNumber, map, '카카오본문', `오늘의 Ryan Daily Talk\n${published.url}`);
}

function writeQueueSendResult_(sheet, rowNumber, sent) {
  const map = queueHeaderMap_(sheet);
  setHeaderCell_(sheet, rowNumber, map, '상태', 'SENT');
  setHeaderCell_(sheet, rowNumber, map, '발송시각', sent.sentAt);
  setHeaderCell_(sheet, rowNumber, map, 'KAKAO_LINK_SENT_AT', sent.sentAt);
  setHeaderCell_(sheet, rowNumber, map, '오류', '');
}

function writeQueueFailure_(sheet, rowNumber, error) {
  const map = queueHeaderMap_(sheet);
  setHeaderCell_(sheet, rowNumber, map, '상태', 'FAILED');
  setHeaderCell_(sheet, rowNumber, map, '오류', error.message || String(error));
}

function queueHeaderMap_(sheet) {
  const headers = sheet.getRange(RM_DAILY_TALK_CONFIG.QUEUE_HEADER_ROW, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const map = {};
  headers.forEach((header, index) => { if (header) map[header] = index + 1; });
  return map;
}

function setHeaderCell_(sheet, rowNumber, map, header, value) {
  if (!map[header]) throw new Error(`콘텐츠대기열에 '${header}' 열이 없습니다.`);
  sheet.getRange(rowNumber, map[header]).setValue(value);
}

function loadDailyTalkSettings_(ss) {
  const sheet = getDailyTalkSheet_(ss, RM_DAILY_TALK_CONFIG.SETTINGS_SHEET);
  const values = sheet.getDataRange().getValues();
  const settings = {};
  values.forEach(row => {
    const key = String(row[0] || '').trim();
    if (key) settings[key] = row[1];
  });
  return settings;
}

function appendDailyTalkSendLogs_(recipients, item, result, sentAt) {
  const ss = SpreadsheetApp.openById(RM_DAILY_TALK_CONFIG.OPERATIONS_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(RM_DAILY_TALK_CONFIG.LOG_SHEET);
  if (!sheet) return;
  recipients.forEach(recipient => {
    sheet.appendRow([
      Utilities.getUuid(), sentAt, item.contentId, recipient.studentName, recipient.phone,
      recipient.track, 'SENT', item.wixContentUrl, JSON.stringify(result)
    ]);
  });
}

function parseChunks_(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (_) {
    return String(value).split(/\n+/).filter(Boolean);
  }
}

function parseSourceUrls_(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return String(value)
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(item => /^https?:\/\//i.test(item));
}

function toDailyTalkBoolean_(value) {
  return value === true || ['true', 'TRUE', '1', 'yes', 'YES', 'y', 'Y'].includes(String(value || '').trim());
}

function normalizeDailyTalkPhone_(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.indexOf('010') === 0) {
    return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
  }
  return String(value || '').trim();
}

function findWixDataItemBySlug_(apiKey, settings, collectionId, slug) {
  const response = callWixDataApi_(apiKey, settings, 'https://www.wixapis.com/wix-data/v2/items/query', 'post', {
    dataCollectionId: collectionId,
    query: {
      filter: {slug: {$eq: slug}},
      paging: {limit: 1, offset: 0}
    }
  });
  const items = response.dataItems || [];
  return items.length ? items[0] : null;
}

function insertWixDataItem_(apiKey, settings, collectionId, data) {
  const response = callWixDataApi_(apiKey, settings, 'https://www.wixapis.com/wix-data/v2/items', 'post', {
    dataCollectionId: collectionId,
    dataItem: {data}
  });
  return response.dataItem || {};
}

function updateWixDataItem_(apiKey, settings, collectionId, itemId, data) {
  const response = callWixDataApi_(apiKey, settings, `https://www.wixapis.com/wix-data/v2/items/${encodeURIComponent(itemId)}`, 'put', {
    dataCollectionId: collectionId,
    dataItem: {data}
  });
  return response.dataItem || {};
}

function callWixDataApi_(apiKey, settings, url, method, body) {
  const response = UrlFetchApp.fetch(url, {
    method,
    contentType: 'application/json',
    headers: {
      Authorization: apiKey,
      'wix-site-id': settings.WIX_SITE_ID || RM_DAILY_TALK_CONFIG.WIX_SITE_ID
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error(`Wix CMS 저장 실패 (${status}): ${text.slice(0, 700)}`);
  }
  return text ? JSON.parse(text) : {};
}

function makeDailyTalkSlug_(item) {
  const track = String(item.track || 'SMALL_TALK').toLowerCase().replace(/_/g, '-');
  const date = formatDateForWix_(item.sendDate || new Date());
  const raw = String(item.topicEn || item.topicKo || item.contentId || 'daily-talk').toLowerCase();
  const topic = raw
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || String(item.contentId || 'daily-talk').toLowerCase();
  return `${track}-${date}-${topic}`;
}

function buildMagazineUrl_(slug, settings) {
  const base = String(settings.WIX_MAGAZINE_BASE_URL || RM_DAILY_TALK_CONFIG.WIX_MAGAZINE_BASE_URL).replace(/\/+$/, '');
  return `${base}/${slug}`;
}

function formatDateForWix_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy-MM-dd');
  }
  const text = String(value || '').trim();
  const match = text.match(/^\\d{4}-\\d{2}-\\d{2}/);
  if (match) return match[0];
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy-MM-dd');
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cell_(row, headerMap, header) {
  return headerMap[header] === undefined ? '' : row[headerMap[header]];
}

function getDailyTalkSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`필수 시트 '${name}'를 찾을 수 없습니다.`);
  return sheet;
}
