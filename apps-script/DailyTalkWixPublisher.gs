const RM_DAILY_TALK_CONFIG = Object.freeze({
  OPERATIONS_SPREADSHEET_ID: '1vpPKVhDOj9Np5RL-Afu7vTHTqm4gfG3M5MCqkWmUeDE',
  SETTINGS_SHEET: '설정',
  QUEUE_SHEET: '콘텐츠대기열',
  LOG_SHEET: '발송로그',
  QUEUE_HEADER_ROW: 3,
  WIX_SITE_ID: '77af5a69-40e6-48a1-a727-03aee59a6da4',
  WIX_CATEGORY_ID: '736b3232-2c06-4ff8-bf2d-970a5d838cba',
  WIX_MEMBER_ID: '13661272-2b5b-f6ec-d5dc-e8caa85bc8a6',
  WIX_CATEGORY_URL: 'https://www.ryanmembers.com/blog/categories/daily-talk',
  SOLAPI_SEND_URL: 'https://api.solapi.com/messages/v4/send-many/detail'
});

/**
 * Main weekday pipeline:
 * 1. Publish APPROVED queue rows to the Ryan Daily Talk Wix Blog category.
 * 2. Send the published Wix URL to ACTIVE English Passport recipients by Kakao Brand Message.
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

  const title = `[Ryan Daily Talk] ${item.topicKo || item.topicEn || item.contentId}`;
  const richContent = buildDailyTalkRichContent_(item);
  const requestBody = {
    draftPost: {
      title,
      excerpt: String(item.snackKo || item.snackEn || '').slice(0, 250),
      featured: false,
      categoryIds: [settings.WIX_BLOG_CATEGORY_ID || RM_DAILY_TALK_CONFIG.WIX_CATEGORY_ID],
      memberId: RM_DAILY_TALK_CONFIG.WIX_MEMBER_ID,
      hashtags: ['RyanDailyTalk', item.track === 'BUSINESS' ? '비즈니스영어' : '영어회화'],
      commentingEnabled: false,
      language: 'ko',
      richContent
    },
    publish: true,
    fieldsets: ['URL', 'RICH_CONTENT']
  };

  const response = UrlFetchApp.fetch('https://www.wixapis.com/blog/v3/draft-posts', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: apiKey,
      'wix-site-id': settings.WIX_SITE_ID || RM_DAILY_TALK_CONFIG.WIX_SITE_ID
    },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error(`Wix 게시 실패 (${status}): ${text.slice(0, 500)}`);
  }

  const parsed = JSON.parse(text);
  const draftPost = parsed.draftPost || {};
  const url = resolveWixPostUrl_(draftPost.url) || settings.WIX_BLOG_CATEGORY_URL || RM_DAILY_TALK_CONFIG.WIX_CATEGORY_URL;
  return {
    postId: draftPost.id || '',
    url,
    publishedAt: new Date()
  };
}

function buildDailyTalkRichContent_(item) {
  const nodes = [];
  if (item.topicEn) nodes.push(headingNode_(item.topicEn, 2));
  if (item.topicKo) nodes.push(paragraphNode_(item.topicKo));
  if (item.snackEn) nodes.push(headingNode_('Today’s Language Snack', 3), paragraphNode_(item.snackEn));
  if (item.snackKo) nodes.push(paragraphNode_(item.snackKo));

  const chunks = parseChunks_(item.chunksJson);
  if (chunks.length) {
    nodes.push(headingNode_('Useful Chunks', 3));
    chunks.forEach(chunk => nodes.push(paragraphNode_(typeof chunk === 'string' ? chunk : JSON.stringify(chunk))));
  }

  if (item.modelEn) nodes.push(headingNode_('Model Answer', 3), paragraphNode_(item.modelEn));
  if (item.modelKo) nodes.push(paragraphNode_(item.modelKo));
  if (item.yourTurnEn) nodes.push(headingNode_('Your Turn', 3), paragraphNode_(item.yourTurnEn));
  if (item.yourTurnKo) nodes.push(paragraphNode_(item.yourTurnKo));
  nodes.push(paragraphNode_('Ryan Members · English Opens a New World.'));

  return {nodes};
}

function sendDailyTalkWixLink_(item, settings) {
  const recipients = getActiveDailyTalkRecipients().filter(recipient => {
    if (item.track === 'BUSINESS') return recipient.track === 'BUSINESS' || recipient.track === 'BOTH';
    return recipient.track === 'SMALL_TALK' || recipient.track === 'BOTH';
  });

  const maxRecipients = Number(settings.MAX_RECIPIENTS_PER_RUN || 300);
  const targets = recipients.slice(0, maxRecipients);
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

/**
 * Manual one-off test send to the operator's own phone via SOLAPI Kakao.
 * Does not touch the content queue, student contacts, or send logs — safe
 * to run without affecting the production Daily Talk pipeline.
 *
 * Required Script Property:
 * - TEST_OWNER_PHONE (010-XXXX-XXXX or digits-only; not read from anywhere else)
 *
 * Reuses the operational Settings sheet's SOLAPI_PF_ID (same value the
 * production pipeline uses) and the existing callSolapi_ / auth helpers.
 */
function testDailyTalkSendToOwner() {
  const testPhone = String(PropertiesService.getScriptProperties().getProperty('TEST_OWNER_PHONE') || '').trim();
  if (!testPhone) throw new Error('Script Properties에 TEST_OWNER_PHONE이 없습니다.');

  const ss = SpreadsheetApp.openById(RM_DAILY_TALK_CONFIG.OPERATIONS_SPREADSHEET_ID);
  const settings = loadDailyTalkSettings_(ss);
  const pfId = String(settings.SOLAPI_PF_ID || '').trim();
  if (!pfId || pfId.indexOf('...') !== -1) throw new Error('설정 시트의 SOLAPI_PF_ID가 실제 값으로 입력되지 않았습니다.');

  const linkUrl = RM_DAILY_TALK_CONFIG.WIX_CATEGORY_URL;
  const text = [
    '[TEST] 라이언멤버스 Ryan Daily Talk',
    '이 메시지는 운영자 발송 테스트입니다. 학생에게는 전송되지 않았습니다.',
    '',
    linkUrl
  ].join('\n');

  const messages = [{
    to: testPhone.replace(/\D/g, ''),
    text,
    kakaoOptions: {
      pfId,
      disableSms: true,
      bms: {
        targeting: 'I',
        chatBubbleType: 'TEXT',
        adult: false,
        buttons: [{
          name: '오늘의 영어 열기',
          linkType: 'WL',
          linkMobile: linkUrl,
          linkPc: linkUrl
        }]
      }
    },
    customFields: {
      source: 'MANUAL_OWNER_TEST',
      contentId: 'TEST'
    }
  }];

  const result = callSolapi_(messages);
  Logger.log('testDailyTalkSendToOwner: sent to ***%s, result=%s', testPhone.replace(/\D/g, '').slice(-4), JSON.stringify(result));
  return {ok: true, sentTo: 'ends with ' + testPhone.replace(/\D/g, '').slice(-4), result};
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

function resolveWixPostUrl_(urlObject) {
  if (!urlObject) return '';
  if (typeof urlObject === 'string') return urlObject;
  return String(urlObject.base || '') + String(urlObject.path || '');
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

function headingNode_(text, level) {
  return {
    type: 'HEADING',
    id: Utilities.getUuid(),
    nodes: [textNode_(text)],
    headingData: {level: level || 2}
  };
}

function paragraphNode_(text) {
  return {
    type: 'PARAGRAPH',
    id: Utilities.getUuid(),
    nodes: [textNode_(text)],
    paragraphData: {}
  };
}

function textNode_(text) {
  return {
    type: 'TEXT',
    id: Utilities.getUuid(),
    nodes: [],
    textData: {text: String(text || ''), decorations: []}
  };
}

function cell_(row, headerMap, header) {
  return headerMap[header] === undefined ? '' : row[headerMap[header]];
}

function getDailyTalkSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`필수 시트 '${name}'를 찾을 수 없습니다.`);
  return sheet;
}
