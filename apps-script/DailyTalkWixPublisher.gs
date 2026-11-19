/**
 * DailyTalkWixPublisher.gs
 *
 * Ryan Daily Talk publication + send pipeline.
 *
 *   generate (queue)  ->  publish to the Wix CMS collection RyanDailyTalkContent
 *   (/rm-magazine/{slug})  ->  store the final magazine URL  ->  send the URL as a SOLAPI Kakao Brand
 *   Message (targeting I, SMS fallback off)  ->  update lastDailyTalkSentAt and
 *   the send log.
 *
 * Safety rules enforced here:
 *  - Secrets come only from PropertiesService (never from code or Sheets).
 *  - TEST_MODE=true sends only to TEST_PHONE; real students are never messaged.
 *  - BMS targeting must be 'I' (channel friends) and disableSms is always true.
 *  - A recipient is marked as sent only for a confirmed SOLAPI acceptance
 *    (statusCode 2000). Failures and unverifiable responses are preserved.
 *  - Sends are idempotent per CONTENT_ID + phone (send log + in-run dedupe).
 */

var RM_DAILY_TALK_CONFIG = Object.freeze({
  OPERATIONS_SPREADSHEET_ID: '1vpPKVhDOj9Np5RL-Afu7vTHTqm4gfG3M5MCqkWmUeDE',
  SETTINGS_SHEET: '설정',
  QUEUE_SHEET: '콘텐츠대기열',
  LOG_SHEET: '발송로그',
  QUEUE_HEADER_ROW: 3,
  WIX_SITE_ID: '77af5a69-40e6-48a1-a727-03aee59a6da4',
  WIX_CATEGORY_ID: '736b3232-2c06-4ff8-bf2d-970a5d838cba',
  WIX_MEMBER_ID: '13661272-2b5b-f6ec-d5dc-e8caa85bc8a6',
  WIX_CATEGORY_URL: 'https://www.ryanmembers.com/blog/categories/daily-talk',
  WIX_DATA_API_BASE: 'https://www.wixapis.com/wix-data/v2',
  WIX_PUBLICATION_MODE: 'CMS_MAGAZINE',
  WIX_CMS_COLLECTION_ID: 'RyanDailyTalkContent',
  WIX_CMS_PUBLISHED_STATUS: 'PUBLISHED',
  WIX_MAGAZINE_BASE_URL: 'https://www.ryanmembers.com/rm-magazine',
  SOLAPI_SEND_URL: 'https://api.solapi.com/messages/v4/send-many/detail',
  SOLAPI_PF_ID: 'KA01PF260722185348723BlBV44r241y',
  BMS_TARGETING: 'I',
  KAKAO_CHANNEL_URL: 'https://pf.kakao.com/_xkFxexfX/friend',
  TEST_MODE: true,
  DISABLE_SMS_FALLBACK: true,
  MAX_RECIPIENTS_PER_RUN: 300,
  CONSENT_VERSION: '2026-07-25-v2',
  FOOTER_TEXT: '수신거부: 카카오톡에서 라이언멤버스 채널을 차단해 주세요.',
  LOG_HEADERS: ['발송ID', '발송시각', 'CONTENT_ID', '이름', '전화번호', '트랙', '상태',
    'WIX_URL', 'PROVIDER_MESSAGE_ID', 'PROVIDER_STATUS', '오류', '모드']
});

/**
 * Main weekday pipeline. Safe to run repeatedly: already-sent content+phone
 * pairs are skipped, and nothing is retried into a real student while
 * TEST_MODE is true.
 */
function runDailyTalkPipeline(options) {
  var opts = options || {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, errorCode: 'BUSY' };

  try {
    var ss = SpreadsheetApp.openById(rmDailyTalkOperationsSpreadsheetId_());
    var settings = loadDailyTalkSettings_(ss);
    var testMode = isTestMode_(settings);

    // AUTO_GENERATE: make sure today's content exists before the send step.
    var generation = null;
    if (isAutoGenerateEnabled_(settings)) {
      try {
        generation = generateDailyTalkContentIfNeeded({ ss: ss, settings: settings });
      } catch (generationError) {
        generation = { ok: false, error: String(generationError && generationError.message ? generationError.message : generationError) };
      }
    }

    var queue = getDailyTalkSheet_(ss, RM_DAILY_TALK_CONFIG.QUEUE_SHEET);
    var queueHeaderUnit = queueHeaderMap_(queue);
    var items = readQueueRows_(queue);
    var logIndex = readSendLogIndex_(ss);
    var audience = testMode ? [] : getAudienceForSend_().recipients;
    var sessionSentKeys = {}; // contentId+phone already accepted in this run
    var results = [];

    items.forEach(function (item) {
      if (item.status !== 'APPROVED' && item.status !== 'PUBLISHED') return;
      if (item.status === 'SENT') return;
      try {
        if (!item.wixContentUrl) {
          var published = publishDailyTalkToWix_(item, settings);
          writeQueuePublishingResult_(queue, queueHeaderUnit, item.rowNumber, published);
          item.wixContentUrl = published.url;
        }
        if (!isValidWixPostUrl(item.wixContentUrl)) {
          throw new Error('Wix 게시물 URL이 아직 없습니다: ' + item.wixContentUrl);
        }
        if (item.kakaoLinkSentAt) return;

        var plan = buildSendPlan([{
          contentId: item.contentId,
          track: item.track,
          targets: testMode ? testRecipients_(settings) : audience,
          alreadySentKeys: Object.assign({}, logIndex.keys, sessionSentKeys)
        }], { maxRecipients: Number(settings.MAX_RECIPIENTS_PER_RUN) || RM_DAILY_TALK_CONFIG.MAX_RECIPIENTS_PER_RUN });

        if (!plan.targets.length) {
          results.push({ contentId: item.contentId, ok: true, sentCount: 0, reason: 'NO_TARGETS', skipped: plan.skipped.length });
          return;
        }

        var sendResult = dispatchKakaoMessages_(item, plan.targets, settings, testMode);
        (sendResult.sentKeys || []).forEach(function (key) { sessionSentKeys[key] = true; });
        writeQueueSendResult_(queue, queueHeaderUnit, item.rowNumber, sendResult, testMode);
        results.push({
          contentId: item.contentId,
          ok: sendResult.sentCount > 0 && sendResult.failedCount === 0,
          sentCount: sendResult.sentCount,
          failedCount: sendResult.failedCount,
          testMode: testMode,
          skipped: plan.skipped.length
        });
      } catch (error) {
        writeQueueFailure_(queue, queueHeaderUnit, item.rowNumber, error);
        results.push({ contentId: item.contentId, ok: false, error: String(error && error.message ? error.message : error) });
      }
    });

    return {
      ok: true,
      testMode: testMode,
      audienceSize: audience.length,
      generated: generation ? (generation.generated || []).map(function (item) {
        return { contentId: item.contentId, track: item.track, model: item.model, status: item.status };
      }) : [],
      generationError: generation && generation.ok === false ? (generation.error || generation.failures) : null,
      processed: results.length,
      results: results
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Phase 7 controlled test: one Kakao Brand Message to TEST_PHONE only.
 * The message must contain a real Wix Daily Talk post URL.
 */
function sendDailyTalkTestToOwner(wixUrlOverride) {
  var ss = SpreadsheetApp.openById(rmDailyTalkOperationsSpreadsheetId_());
  var settings = loadDailyTalkSettings_(ss);
  if (!isTestMode_(settings)) {
    throw new Error('TEST_MODE가 꺼져 있습니다. 테스트 발송은 TEST_MODE=true에서만 실행합니다.');
  }

  var testPhone = String(getScriptProperty_('TEST_PHONE') || getScriptProperty_('TEST_OWNER_PHONE') ||
    settings.TEST_PHONE || '').trim();
  if (!isDailyTalkPhone(testPhone)) throw new Error('TEST_PHONE이 없거나 010 휴대전화번호가 아닙니다.');

  var wixUrl = String(wixUrlOverride || settings.TEST_WIX_URL || '').trim();
  if (!isValidWixPostUrl(wixUrl)) {
    throw new Error('테스트 메시지에 넣을 Wix Daily Talk 게시물 URL이 없습니다. 실제 게시물 URL을 지정해 주세요.');
  }

  var item = {
    contentId: 'TEST-' + Utilities.formatDate(new Date(), RM_PASSPORT_CONFIG.TIMEZONE, 'yyyyMMdd-HHmmss'),
    track: 'SMALL_TALK',
    topicKo: '발송 테스트',
    topicEn: 'Delivery test',
    wixContentUrl: wixUrl
  };

  var targets = [{ name: '운영자 테스트', phone: normalizePhone(testPhone), track: 'SMALL_TALK', contentId: item.contentId, key: buildSendKey(item.contentId, testPhone) }];
  var result = dispatchKakaoMessages_(item, targets, settings, true);

  var detail = JSON.parse(result.detail || '{}');
  var outcome = detail.results && detail.results[0] ? detail.results[0] : {};
  var summary = {
    ok: result.sentCount === 1,
    contentId: item.contentId,
    targeted: 'ends-with-' + normalizePhone(testPhone).slice(-4),
    targeting: RM_DAILY_TALK_CONFIG.BMS_TARGETING,
    sentCount: result.sentCount,
    failedCount: result.failedCount,
    providerMessageId: outcome.messageId || String(detail.groupId || ''),
    providerStatus: outcome.status || '',
    providerStatusCode: outcome.statusCode || 0,
    reason: outcome.reason || ''
  };
  Logger.log(JSON.stringify(summary));
  return summary;
}

/**
 * Publishes one queue item to Wix.
 *
 * The Daily Talk pages live at /rm-magazine/{slug}, fed by the Wix CMS
 * collection RyanDailyTalkContent, so CMS_MAGAZINE is the path the site uses.
 * WIX_PUBLICATION_MODE=BLOG keeps the old Blog API path for a rollback only;
 * the API key in Script Properties has no Blog scope (401/403).
 */
function publishDailyTalkToWix_(item, settings) {
  if (resolveWixPublicationMode_(settings) === 'BLOG') return publishDailyTalkToWixBlog_(item, settings);
  return publishDailyTalkToWixCms_(item, settings);
}

/**
 * Inserts (or updates, when the slug already exists) one item in the Wix CMS
 * collection and returns the public magazine URL plus the CMS item id.
 */
function publishDailyTalkToWixCms_(item, settings) {
  var apiKey = getScriptProperty_('WIX_API_KEY');
  if (!apiKey) throw new Error('Script Properties에 WIX_API_KEY가 없습니다.');

  var config = resolveWixCmsConfig_(settings);
  if (!config.collectionId) throw new Error('WIX_CMS_COLLECTION_ID가 비어 있습니다.');

  var now = new Date();
  var slug = buildDailyTalkCmsSlug_(item, { now: now });
  var data = buildDailyTalkCmsData_(item, {
    slug: slug,
    baseUrl: config.baseUrl,
    now: now,
    footerText: settings && settings.FOOTER_TEXT
  });

  var existingId = findDailyTalkCmsItemIdBySlug_(config, slug, apiKey);
  var saved = existingId
    ? patchDailyTalkCmsItem_(config, existingId, data, apiKey)
    : insertDailyTalkCmsItem_(config, data, apiKey);

  var itemId = String((saved && saved.id) || existingId || '').trim();
  if (!itemId) throw new Error('Wix CMS 저장 응답에 item id가 없습니다.');
  var savedSlug = String((saved && saved.data && saved.data.slug) || '').trim();
  if (savedSlug && savedSlug !== slug) throw new Error('Wix CMS 슬러그가 요청과 다릅니다: ' + savedSlug);

  return {
    postId: itemId,
    url: data.magazineUrl,
    publishedAt: now,
    slug: slug,
    kakaoText: data.kakaoText,
    publishedMode: 'CMS_MAGAZINE'
  };
}

/** Legacy path: Wix Blog draft-posts (needs Blog write scope; not used by default). */
function publishDailyTalkToWixBlog_(item, settings) {
  var apiKey = getScriptProperty_('WIX_API_KEY');
  if (!apiKey) throw new Error('Script Properties에 WIX_API_KEY가 없습니다.');

  var title = '[Ryan Daily Talk] ' + (item.topicKo || item.topicEn || item.contentId);
  var requestBody = {
    draftPost: {
      title: title,
      excerpt: String(item.snackKo || item.snackEn || '').slice(0, 250),
      featured: false,
      categoryIds: [String(settings.WIX_BLOG_CATEGORY_ID || RM_DAILY_TALK_CONFIG.WIX_CATEGORY_ID)],
      memberId: RM_DAILY_TALK_CONFIG.WIX_MEMBER_ID,
      hashtags: ['RyanDailyTalk', item.track === 'BUSINESS' ? '비즈니스영어' : '영어회화'],
      commentingEnabled: false,
      language: 'ko',
      richContent: buildDailyTalkRichContent_(item)
    },
    publish: true,
    fieldsets: ['URL', 'RICH_CONTENT']
  };

  var response = UrlFetchApp.fetch('https://www.wixapis.com/blog/v3/draft-posts', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: apiKey,
      'wix-site-id': String(settings.WIX_SITE_ID || RM_DAILY_TALK_CONFIG.WIX_SITE_ID)
    },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  var text = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('Wix 게시 실패 (' + status + '): ' + text.slice(0, 500));
  }

  var parsed = safeJsonParse(text, {});
  var draftPost = parsed.draftPost || {};
  var url = resolveWixPostUrl_(draftPost.url);
  return {
    postId: draftPost.id || '',
    url: url,
    publishedAt: new Date()
  };
}

function buildDailyTalkRichContent_(item) {
  var nodes = [];
  if (item.topicEn) nodes.push(headingNode_(item.topicEn, 2));
  if (item.topicKo) nodes.push(paragraphNode_(item.topicKo));
  if (item.snackEn) nodes.push(headingNode_('Today’s Language Snack', 3), paragraphNode_(item.snackEn));
  if (item.snackKo) nodes.push(paragraphNode_(item.snackKo));

  var chunks = parseChunks_(item.chunksJson);
  if (chunks.length) {
    nodes.push(headingNode_('Useful Chunks', 3));
    chunks.forEach(function (chunk) {
      nodes.push(paragraphNode_(typeof chunk === 'string' ? chunk : JSON.stringify(chunk)));
    });
  }

  if (item.modelEn) nodes.push(headingNode_('Model Answer', 3), paragraphNode_(item.modelEn));
  if (item.modelKo) nodes.push(paragraphNode_(item.modelKo));
  if (item.yourTurnEn) nodes.push(headingNode_('Your Turn', 3), paragraphNode_(item.yourTurnEn));
  if (item.yourTurnKo) nodes.push(paragraphNode_(item.yourTurnKo));
  nodes.push(paragraphNode_('Ryan Members · English Opens a New World.'));

  return { nodes: nodes };
}

// ---------------------------------------------------------------------------
// Wix CMS (RyanDailyTalkContent -> /rm-magazine/{slug})
// ---------------------------------------------------------------------------

/**
 * Which Wix path publishes. CMS_MAGAZINE is the site's real one; BLOG is kept
 * only for a rollback and needs a Blog-scoped API key.
 */
function resolveWixPublicationMode_(settings) {
  var raw = String((settings && settings.WIX_PUBLICATION_MODE) || RM_DAILY_TALK_CONFIG.WIX_PUBLICATION_MODE).trim().toUpperCase();
  return raw === 'BLOG' ? 'BLOG' : 'CMS_MAGAZINE';
}

/** Site id, CMS collection id and magazine base URL from the 설정 sheet. */
function resolveWixCmsConfig_(settings) {
  var sheet = settings || {};
  return {
    siteId: String(sheet.WIX_SITE_ID || RM_DAILY_TALK_CONFIG.WIX_SITE_ID).trim(),
    collectionId: String(sheet.WIX_CMS_COLLECTION_ID || RM_DAILY_TALK_CONFIG.WIX_CMS_COLLECTION_ID).trim(),
    baseUrl: String(sheet.WIX_MAGAZINE_BASE_URL || RM_DAILY_TALK_CONFIG.WIX_MAGAZINE_BASE_URL).replace(/\/+$/, '')
  };
}

/**
 * /rm-magazine slug. Existing items look like
 * 'small-talk-2026-07-24-surf-fashion' -> '{track}-{publishDate}-{topic words}'.
 * A generated CONTENT_ID ('SMALL_TALK-20261119-making-lunch-plans') carries the
 * same information, so the slug is derived from it and is stable per day.
 */
function buildDailyTalkCmsSlug_(item, options) {
  var value = item || {};
  var explicit = String(value.slug || '').trim().toLowerCase();
  if (explicit) return explicit;

  var track = normalizeTrack(value.track) === RM_TRACKS.BUSINESS ? 'business-talk' : 'small-talk';
  var dateKey = resolveDailyTalkPublishDateKey_(value, options) || '0000-00-00';
  var digits = dateKey.replace(/-/g, '');

  var core = String(value.contentId || '').trim()
    .replace(/^(SMALL_TALK|SMALL-TALK|BUSINESS)[-_]?/i, '')
    .replace(/^[-_]+/, '');
  if (digits && core.indexOf(digits) === 0) core = core.slice(digits.length).replace(/^[-_]+/, '');
  core = slugifyTopic(core) || slugifyTopic(value.topicEn) || 'daily-talk';

  return (track + '-' + dateKey + '-' + core).replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** 'YYYY-MM-DD' from an explicit override, the CONTENT_ID, the send date or now. */
function resolveDailyTalkPublishDateKey_(item, options) {
  var value = item || {};
  var opts = options || {};
  var explicit = normalizeDailyTalkDateKey_(opts.dateKey || value.dateKey || value.publishDate);
  if (explicit) return explicit;

  var fromId = /(\d{8})/.exec(String(value.contentId || ''));
  if (fromId) return normalizeDailyTalkDateKey_(fromId[1]);

  var fromSendDate = normalizeDailyTalkDateKey_(value.sendDate);
  if (fromSendDate) return fromSendDate;

  return normalizeDailyTalkDateKey_(opts.now);
}

/** Accepts a Date, 'YYYY-MM-DD', 'YYYYMMDD' or 'YYYY. M. D.' and returns 'YYYY-MM-DD'. */
function normalizeDailyTalkDateKey_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, RM_PASSPORT_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  var text = String(value).trim();
  var parts = /(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/.exec(text);
  if (parts) return parts[1] + '-' + padDailyTalkNumber_(parts[2]) + '-' + padDailyTalkNumber_(parts[3]);

  var digits = text.replace(/[^0-9]/g, '');
  if (digits.length < 8) return '';
  return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8);
}

function padDailyTalkNumber_(value) {
  var text = String(value).replace(/[^0-9]/g, '');
  return text.length >= 2 ? text : ('0' + text);
}

/** 'small-talk' -> 'Small Talk' for the magazine title prefix. */
function dailyTalkCmsTrackLabel_(track) {
  return normalizeTrack(track) === RM_TRACKS.BUSINESS ? 'Business Talk' : 'Small Talk';
}

/** '[Small Talk] 점심 약속 잡기' — the title pattern the existing items use. */
function buildDailyTalkCmsTitle_(item) {
  var value = item || {};
  var topic = String(value.topicKo || value.topicEn || value.contentId || '').trim();
  return '[' + dailyTalkCmsTrackLabel_(value.track) + '] ' + topic;
}

/** Chunks as a normalized [{en, ko}] array regardless of how the sheet holds them. */
function normalizeDailyTalkChunks_(value) {
  var parsed = parseChunks_(value);
  var out = [];
  (parsed || []).forEach(function (chunk) {
    if (!chunk) return;
    if (typeof chunk === 'string') {
      var parts = chunk.split(/\s*[:：]\s*/);
      var en = String(parts.shift() || '').trim();
      var ko = parts.join(': ').trim();
      if (en) out.push({ en: en, ko: ko });
      return;
    }
    var chunkEn = String(chunk.en || chunk.english || '').trim();
    var chunkKo = String(chunk.ko || chunk.korean || '').trim();
    if (chunkEn) out.push({ en: chunkEn, ko: chunkKo });
  });
  return out;
}

/**
 * CMS item payload for one queue row. Field names follow the RyanDailyTalkContent
 * schema exactly; the queue headers they come from are listed in DEPLOY.md.
 */
function buildDailyTalkCmsData_(item, options) {
  var value = item || {};
  var opts = options || {};
  var baseUrl = String(opts.baseUrl || RM_DAILY_TALK_CONFIG.WIX_MAGAZINE_BASE_URL).replace(/\/+$/, '');
  var slug = String(opts.slug || buildDailyTalkCmsSlug_(value, opts)).trim();
  var url = baseUrl + '/' + slug;
  var track = normalizeTrack(value.track) === RM_TRACKS.BUSINESS ? RM_TRACKS.BUSINESS : RM_TRACKS.SMALL_TALK;
  var chunks = normalizeDailyTalkChunks_(value.chunksJson);
  var level = String(value.level || RM_DAILY_TALK_GEN.DEFAULT_LEVEL).trim().toUpperCase();

  return {
    contentId: String(value.contentId || '').trim(),
    slug: slug,
    title: buildDailyTalkCmsTitle_(value),
    track: track,
    level: level || RM_DAILY_TALK_GEN.DEFAULT_LEVEL,
    status: String(opts.status || RM_DAILY_TALK_CONFIG.WIX_CMS_PUBLISHED_STATUS).trim().toUpperCase(),
    publishDate: resolveDailyTalkPublishDateKey_(value, opts) || '0000-00-00',
    magazineUrl: url,
    topicEn: String(value.topicEn || '').trim(),
    topicKo: String(value.topicKo || '').trim(),
    snackEn: String(value.snackEn || '').trim(),
    snackKo: String(value.snackKo || '').trim(),
    chunksJson: JSON.stringify(chunks),
    modelAnswerEn: String(value.modelEn || value.modelAnswerEn || '').trim(),
    modelAnswerKo: String(value.modelKo || value.modelAnswerKo || '').trim(),
    yourTurnEn: String(value.yourTurnEn || '').trim(),
    yourTurnKo: String(value.yourTurnKo || '').trim(),
    sourceUrls: Array.isArray(value.sourceUrls) ? value.sourceUrls : [],
    contentRich: buildDailyTalkCmsRichContent_(value, chunks),
    contentHtml: buildDailyTalkCmsHtml_(value, chunks),
    kakaoText: String(value.kakaoText || '').trim() ||
      buildKakaoMessageText({ topicKo: value.topicKo, topicEn: value.topicEn, wixContentUrl: url }, opts.footerText),
    generatedByAi: /^OPENAI/i.test(String(value.sources || value.generatedBy || '').trim())
  };
}

/** Ricos nodes in the same shape the existing collection items use. */
function buildDailyTalkCmsRichContent_(item, chunks) {
  var value = item || {};
  var nodes = [];
  if (value.topicEn) nodes.push(cmsHeadingNode_(value.topicEn, 2));
  if (value.topicKo) nodes.push(cmsParagraphNode_(value.topicKo));
  if (value.snackEn || value.snackKo) {
    nodes.push(cmsHeadingNode_('Today’s Language Snack', 3));
    if (value.snackEn) nodes.push(cmsParagraphNode_(value.snackEn));
    if (value.snackKo) nodes.push(cmsParagraphNode_(value.snackKo));
  }

  var list = chunks || normalizeDailyTalkChunks_(value.chunksJson);
  if (list.length) {
    nodes.push(cmsHeadingNode_('Useful Chunks', 3));
    list.forEach(function (chunk) {
      nodes.push(cmsParagraphNode_(chunk.ko ? chunk.en + ': ' + chunk.ko : chunk.en));
    });
  }

  if (value.modelEn || value.modelKo) {
    nodes.push(cmsHeadingNode_('Model Answer', 3));
    if (value.modelEn) nodes.push(cmsParagraphNode_(value.modelEn));
    if (value.modelKo) nodes.push(cmsParagraphNode_(value.modelKo));
  }

  if (value.yourTurnEn || value.yourTurnKo) {
    nodes.push(cmsHeadingNode_('Your Turn', 3));
    if (value.yourTurnEn) nodes.push(cmsParagraphNode_(value.yourTurnEn));
    if (value.yourTurnKo) nodes.push(cmsParagraphNode_(value.yourTurnKo));
  }

  return { nodes: nodes };
}

function cmsHeadingNode_(text, level) {
  return {
    type: 'HEADING',
    headingData: { level: level || 2, textStyle: { textAlignment: 'AUTO' } },
    nodes: [cmsTextNode_(text)]
  };
}

function cmsParagraphNode_(text) {
  return {
    type: 'PARAGRAPH',
    paragraphData: { textStyle: { textAlignment: 'AUTO' } },
    nodes: [cmsTextNode_(text)]
  };
}

function cmsTextNode_(text) {
  return { type: 'TEXT', textData: { decorations: [], text: String(text === null || text === undefined ? '' : text) } };
}

/** contentHtml mirror of the rich content, for templates that render the HTML field. */
function buildDailyTalkCmsHtml_(item, chunks) {
  var value = item || {};
  var parts = [];
  if (value.topicEn) parts.push('<h2>' + escapeDailyTalkHtml_(value.topicEn) + '</h2>');
  if (value.topicKo) parts.push('<p class="topic-ko">' + escapeDailyTalkHtml_(value.topicKo) + '</p>');
  if (value.snackEn || value.snackKo) {
    parts.push('<h3>Today&rsquo;s Language Snack</h3>');
    if (value.snackEn) parts.push('<p>' + escapeDailyTalkHtml_(value.snackEn) + '</p>');
    if (value.snackKo) parts.push('<p>' + escapeDailyTalkHtml_(value.snackKo) + '</p>');
  }

  var list = chunks || normalizeDailyTalkChunks_(value.chunksJson);
  if (list.length) {
    parts.push('<h3>Useful Chunks</h3>');
    list.forEach(function (chunk) {
      parts.push('<p>' + escapeDailyTalkHtml_(chunk.ko ? chunk.en + ': ' + chunk.ko : chunk.en) + '</p>');
    });
  }

  if (value.modelEn || value.modelKo) {
    parts.push('<h3>Model Answer</h3>');
    if (value.modelEn) parts.push('<p>' + escapeDailyTalkHtml_(value.modelEn) + '</p>');
    if (value.modelKo) parts.push('<p>' + escapeDailyTalkHtml_(value.modelKo) + '</p>');
  }

  if (value.yourTurnEn || value.yourTurnKo) {
    parts.push('<h3>Your Turn</h3>');
    if (value.yourTurnEn) parts.push('<p>' + escapeDailyTalkHtml_(value.yourTurnEn) + '</p>');
    if (value.yourTurnKo) parts.push('<p>' + escapeDailyTalkHtml_(value.yourTurnKo) + '</p>');
  }

  return parts.join('');
}

function escapeDailyTalkHtml_(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One wix-data/v2 call; a non-2xx answer becomes an error without the key. */
function wixDataRequest_(config, apiKey, method, path, payload) {
  var options = {
    method: method,
    contentType: 'application/json',
    headers: {
      Authorization: apiKey,
      'wix-site-id': String((config && config.siteId) || RM_DAILY_TALK_CONFIG.WIX_SITE_ID)
    },
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);

  var response = UrlFetchApp.fetch(RM_DAILY_TALK_CONFIG.WIX_DATA_API_BASE + path, options);
  var status = response.getResponseCode();
  var text = String(response.getContentText() === null || response.getContentText() === undefined ? '' : response.getContentText());
  if (status < 200 || status >= 300) {
    // The key travels in the request header; keep it out of any surfaced message.
    var detail = apiKey ? text.split(String(apiKey)).join('[REDACTED]') : text;
    throw new Error('Wix CMS ' + method.toUpperCase() + ' ' + path + ' 실패 (' + status + '): ' + detail.slice(0, 400));
  }
  return safeJsonParse(text, {});
}

/** CMS item id for an existing slug, or '' when the slug is free. */
function findDailyTalkCmsItemIdBySlug_(config, slug, apiKey) {
  var parsed = wixDataRequest_(config, apiKey, 'post', '/items/query', {
    dataCollectionId: config.collectionId,
    query: { filter: { slug: slug }, paging: { limit: 1 } }
  });
  var items = (parsed && parsed.dataItems) || [];
  if (!items.length) return '';
  return String(items[0].id || (items[0].data && items[0].data._id) || '').trim();
}

function insertDailyTalkCmsItem_(config, data, apiKey) {
  var parsed = wixDataRequest_(config, apiKey, 'post', '/items', {
    dataCollectionId: config.collectionId,
    dataItem: { data: data }
  });
  return (parsed && parsed.dataItem) || {};
}

/**
 * Updates only the fields this publisher owns, so columns the CMS editor or the
 * old blog sync filled (blogPostId, blogUrl, ...) are left alone.
 */
function patchDailyTalkCmsItem_(config, itemId, data, apiKey) {
  var modifications = Object.keys(data || {}).map(function (fieldPath) {
    return { fieldPath: fieldPath, action: 'SET_FIELD', setFieldOptions: { value: data[fieldPath] } };
  });
  if (!modifications.length) throw new Error('Wix CMS 패치할 필드가 없습니다: ' + itemId);

  var parsed = wixDataRequest_(config, apiKey, 'patch', '/items/' + encodeURIComponent(itemId), {
    dataCollectionId: config.collectionId,
    patch: { dataItemId: itemId, fieldModifications: modifications }
  });
  return (parsed && parsed.dataItem) || { id: itemId };
}

/**
 * Sends one content item to the planned targets and records the outcome.
 * Only a confirmed per-recipient acceptance updates lastDailyTalkSentAt.
 */
function dispatchKakaoMessages_(item, targets, settings, testMode) {
  var pfId = String(settings.SOLAPI_PF_ID || RM_DAILY_TALK_CONFIG.SOLAPI_PF_ID).trim();
  if (!pfId) throw new Error('SOLAPI_PF_ID가 비어 있습니다.');

  var targeting = String(settings.BMS_TARGETING || RM_DAILY_TALK_CONFIG.BMS_TARGETING).trim().toUpperCase();
  if (targeting !== 'I') {
    // The initial rollout must stay on channel friends only.
    throw new Error('BMS_TARGETING은 I(채널 친구)만 사용합니다. 현재 값: ' + targeting);
  }

  var text = buildKakaoMessageText(item, String(settings.FOOTER_TEXT || RM_DAILY_TALK_CONFIG.FOOTER_TEXT));
  var messages = targets.map(function (target) {
    return {
      to: String(target.phone).replace(/\D/g, ''),
      text: text,
      kakaoOptions: {
        pfId: pfId,
        disableSms: true, // SMS fallback stays disabled for every send
        bms: {
          targeting: targeting,
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
        source: testMode ? 'DAILY_TALK_TEST' : 'ENGLISH_PASSPORT'
      }
    };
  });

  var sentAt = new Date();
  var response = callSolapi_(messages);
  var parsed = parseSolapiResponse(response, targets.map(function (target) { return target.phone; }));

  var byPhone = {};
  parsed.results.forEach(function (result) { byPhone[result.phone] = result; });
  var providerGroupId = String(parsed.groupId || '');

  var logRows = [];
  var sentKeys = [];
  var sentCount = 0;
  var failedCount = 0;

  targets.forEach(function (target) {
    var outcome = byPhone[target.phone] || { ok: false, status: 'FAILED', reason: 'NO_RESULT', messageId: '' };
    var status = outcome.ok ? 'SENT' : (outcome.pending ? 'PENDING' : 'FAILED');
    if (outcome.ok) {
      sentCount += 1;
      sentKeys.push(buildSendKey(item.contentId, target.phone));
      if (!testMode) markDailyTalkSent(target.phone, sentAt);
    } else {
      failedCount += 1;
    }
    logRows.push([
      Utilities.getUuid(),
      sentAt,
      item.contentId,
      target.name || '',
      target.phone,
      target.track || item.track || '',
      status,
      item.wixContentUrl,
      outcome.messageId || providerGroupId,
      String(outcome.statusCode || ''),
      outcome.reason || '',
      testMode ? 'TEST' : 'LIVE'
    ]);
  });

  appendSendLogRows_(logRows);

  return {
    sentCount: sentCount,
    failedCount: failedCount,
    sentKeys: sentKeys,
    sentAt: sentAt,
    verified: parsed.verified,
    detail: JSON.stringify({ results: parsed.results, groupId: providerGroupId })
  };
}

function callSolapi_(messages) {
  var apiKey = getScriptProperty_('SOLAPI_API_KEY');
  var apiSecret = getScriptProperty_('SOLAPI_API_SECRET');
  if (!apiKey || !apiSecret) throw new Error('Script Properties에 SOLAPI_API_KEY 또는 SOLAPI_API_SECRET이 없습니다.');

  var response = UrlFetchApp.fetch(RM_DAILY_TALK_CONFIG.SOLAPI_SEND_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: createSolapiAuthHeader_(apiKey, apiSecret) },
    payload: JSON.stringify({
      messages: messages,
      strict: false,
      allowDuplicates: false,
      showMessageList: true
    }),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  var text = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('SOLAPI 발송 실패 (' + status + '): ' + text.slice(0, 700));
  }
  return safeJsonParse(text, {});
}

function createSolapiAuthHeader_(apiKey, apiSecret) {
  var dateTime = new Date().toISOString();
  var salt = Utilities.getUuid().replace(/-/g, '');
  var signatureBytes = Utilities.computeHmacSha256Signature(dateTime + salt, apiSecret);
  var signature = signatureBytes.map(function (byte) {
    var unsigned = byte < 0 ? byte + 256 : byte;
    return ('0' + unsigned.toString(16)).slice(-2);
  }).join('');
  return 'HMAC-SHA256 apiKey=' + apiKey + ', date=' + dateTime + ', salt=' + salt + ', signature=' + signature;
}

// ---------------------------------------------------------------------------
// Queue / log / settings I/O
// ---------------------------------------------------------------------------

function readQueueRows_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow <= RM_DAILY_TALK_CONFIG.QUEUE_HEADER_ROW) return [];
  var headers = sheet.getRange(RM_DAILY_TALK_CONFIG.QUEUE_HEADER_ROW, 1, 1, lastColumn).getDisplayValues()[0];
  var headerMap = {};
  headers.forEach(function (header, index) { if (header) headerMap[String(header).trim()] = index; });
  var values = sheet.getRange(RM_DAILY_TALK_CONFIG.QUEUE_HEADER_ROW + 1, 1, lastRow - RM_DAILY_TALK_CONFIG.QUEUE_HEADER_ROW, lastColumn).getValues();

  return values.map(function (row, index) {
    return {
      rowNumber: index + RM_DAILY_TALK_CONFIG.QUEUE_HEADER_ROW + 1,
      contentId: String(cell_(row, headerMap, 'CONTENT_ID') || '').trim(),
      sendDate: cell_(row, headerMap, '발송일'),
      track: normalizeTrack(cell_(row, headerMap, '트랙')) || RM_TRACKS.SMALL_TALK,
      level: cell_(row, headerMap, '레벨'),
      status: String(cell_(row, headerMap, '상태') || '').trim().toUpperCase(),
      topicEn: cell_(row, headerMap, 'TOPIC_EN'),
      topicKo: cell_(row, headerMap, 'TOPIC_KO'),
      snackEn: cell_(row, headerMap, 'SNACK_EN'),
      snackKo: cell_(row, headerMap, 'SNACK_KO'),
      chunksJson: cell_(row, headerMap, 'CHUNKS_JSON'),
      modelEn: cell_(row, headerMap, 'MODEL_EN'),
      modelKo: cell_(row, headerMap, 'MODEL_KO'),
      yourTurnEn: cell_(row, headerMap, 'YOUR_TURN_EN'),
      yourTurnKo: cell_(row, headerMap, 'YOUR_TURN_KO'),
      wixContentUrl: String(cell_(row, headerMap, 'WIX_CONTENT_URL') || '').trim(),
      wixPostId: cell_(row, headerMap, 'WIX_POST_ID'),
      wixPublishedAt: cell_(row, headerMap, 'WIX_PUBLISHED_AT'),
      kakaoLinkSentAt: cell_(row, headerMap, 'KAKAO_LINK_SENT_AT') || cell_(row, headerMap, '발송시각')
    };
  }).filter(function (item) { return item.contentId; });
}

function queueHeaderMap_(sheet) {
  var headers = sheet.getRange(RM_DAILY_TALK_CONFIG.QUEUE_HEADER_ROW, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var map = {};
  headers.forEach(function (header, index) { if (header) map[String(header).trim()] = index + 1; });
  return map;
}

function writeQueuePublishingResult_(sheet, headerUnit, rowNumber, published) {
  setHeaderCell_(sheet, rowNumber, headerUnit, 'WIX_CONTENT_URL', published.url);
  setHeaderCell_(sheet, rowNumber, headerUnit, 'WIX_POST_ID', published.postId);
  setHeaderCell_(sheet, rowNumber, headerUnit, 'WIX_PUBLISHED_AT', published.publishedAt);
  var kakaoText = String(published.kakaoText || '').trim() || ('오늘의 Ryan Daily Talk\n' + published.url);
  setHeaderCell_(sheet, rowNumber, headerUnit, '카카오본문', kakaoText);
}

function writeQueueSendResult_(sheet, headerUnit, rowNumber, sendResult, testMode) {
  if (sendResult.failedCount > 0 && sendResult.sentCount === 0) {
    setHeaderCell_(sheet, rowNumber, headerUnit, '상태', 'FAILED');
    setHeaderCell_(sheet, rowNumber, headerUnit, '오류', '발송 실패: 로그의 PROVIDER_STATUS를 확인하세요.');
    return;
  }
  setHeaderCell_(sheet, rowNumber, headerUnit, '상태', testMode ? 'TEST_SENT' : 'SENT');
  setHeaderCell_(sheet, rowNumber, headerUnit, '발송시각', sendResult.sentAt);
  setHeaderCell_(sheet, rowNumber, headerUnit, 'KAKAO_LINK_SENT_AT', sendResult.sentAt);
  setHeaderCell_(sheet, rowNumber, headerUnit, '오류', sendResult.failedCount > 0 ? (sendResult.failedCount + '건 실패') : '');
}

function writeQueueFailure_(sheet, headerUnit, rowNumber, error) {
  setHeaderCell_(sheet, rowNumber, headerUnit, '상태', 'FAILED');
  setHeaderCell_(sheet, rowNumber, headerUnit, '오류', String(error && error.message ? error.message : error).slice(0, 480));
}

function setHeaderCell_(sheet, rowNumber, headerUnit, header, value) {
  var column = headerUnit[header];
  if (!column) return false;
  sheet.getRange(rowNumber, column).setValue(value);
  return true;
}

function loadDailyTalkSettings_(ss) {
  var sheet = getDailyTalkSheet_(ss, RM_DAILY_TALK_CONFIG.SETTINGS_SHEET);
  var values = sheet.getDataRange().getValues();
  var settings = {};
  values.forEach(function (row) {
    var key = String(row[0] || '').trim();
    if (key && row[1] !== '' && row[1] !== null && row[1] !== undefined) settings[key] = row[1];
  });
  return settings;
}

function isTestMode_(settings) {
  var raw = settings && settings.TEST_MODE !== undefined ? settings.TEST_MODE : RM_DAILY_TALK_CONFIG.TEST_MODE;
  return toBoolean(raw);
}

function testRecipients_(settings) {
  var phone = normalizePhone(getScriptProperty_('TEST_PHONE') || getScriptProperty_('TEST_OWNER_PHONE') || settings.TEST_PHONE);
  if (!phone) return [];
  return [{ name: '운영자 테스트', phone: phone, track: RM_TRACKS.BOTH, rowNumber: 0 }];
}

/** Reads the send log and returns the set of contentId+phone already accepted. */
function readSendLogIndex_(ss) {
  var sheet = ss.getSheetByName(RM_DAILY_TALK_CONFIG.LOG_SHEET);
  if (!sheet) return { keys: {}, rows: 0 };
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { keys: {}, rows: 0 };
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  var contentIndex = headers.indexOf('CONTENT_ID');
  var phoneIndex = headers.indexOf('전화번호');
  var statusIndex = headers.indexOf('상태');
  if (contentIndex === -1 || phoneIndex === -1) return { keys: {}, rows: 0 };

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var rows = values.map(function (row) {
    return {
      contentId: row[contentIndex],
      phone: row[phoneIndex],
      status: statusIndex === -1 ? 'SENT' : row[statusIndex]
    };
  });
  return { keys: buildAlreadySentKeySet(rows), rows: rows.length };
}

function appendSendLogRows_(rows) {
  if (!rows || !rows.length) return;
  var ss = SpreadsheetApp.openById(rmDailyTalkOperationsSpreadsheetId_());
  var sheet = ss.getSheetByName(RM_DAILY_TALK_CONFIG.LOG_SHEET);
  if (!sheet) return;
  ensureSheetHeaders_(sheet, RM_DAILY_TALK_CONFIG.LOG_HEADERS);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, Math.max(rows[0].length, 1)).setValues(rows);
}

function ensureSheetHeaders_(sheet, requiredHeaders) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  var missing = requiredHeaders.filter(function (header) { return headers.indexOf(header) === -1; });
  if (!missing.length) return headers;
  if (sheet.getMaxColumns() < headers.length + missing.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length + missing.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  return headers.concat(missing);
}

/** One-time check of the Daily Talk operations sheet layout (read only). */
function inspectDailyTalkSheets() {
  var ss = SpreadsheetApp.openById(rmDailyTalkOperationsSpreadsheetId_());
  var report = { ok: true, spreadsheetId: ss.getId(), sheets: {} };
  [RM_DAILY_TALK_CONFIG.SETTINGS_SHEET, RM_DAILY_TALK_CONFIG.QUEUE_SHEET, RM_DAILY_TALK_CONFIG.LOG_SHEET].forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) { report.sheets[name] = { exists: false }; return; }
    var lastColumn = Math.max(sheet.getLastColumn(), 1);
    report.sheets[name] = {
      exists: true,
      lastRow: sheet.getLastRow(),
      headers: sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    };
  });
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/** Adds the Ryan Daily Talk menu to the operations spreadsheet. */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('Ryan Daily Talk')
      .addItem('발송 파이프라인 실행', 'runDailyTalkPipeline')
      .addItem('오늘 콘텐츠 생성', 'generateTodayDailyTalkContent')
      .addItem('콘텐츠 생성 설정 점검', 'checkDailyTalkGeneratorSetup')
      .addItem('운영자 테스트 발송', 'sendDailyTalkTestToOwner')
      .addItem('발송대상 새로고침', 'refreshDailyTalkAudienceMirror')
      .addItem('시트 구조 확인', 'inspectDailyTalkSheets')
      .addToUi();
  } catch (ignored) {
    // onOpen also fires for the Passport workbook, which has no UI menu need.
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getScriptProperty_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function resolveWixPostUrl_(urlObject) {
  if (!urlObject) return '';
  if (typeof urlObject === 'string') return urlObject;
  return String(urlObject.base || '') + String(urlObject.path || '');
}

function parseChunks_(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  var parsed = safeJsonParse(String(value), null);
  if (Array.isArray(parsed)) return parsed;
  if (parsed) return [parsed];
  return String(value).split(/\n+/).filter(Boolean);
}

function headingNode_(text, level) {
  return { type: 'HEADING', id: Utilities.getUuid(), nodes: [textNode_(text)], headingData: { level: level || 2 } };
}

function paragraphNode_(text) {
  return { type: 'PARAGRAPH', id: Utilities.getUuid(), nodes: [textNode_(text)], paragraphData: {} };
}

function textNode_(text) {
  return { type: 'TEXT', id: Utilities.getUuid(), nodes: [], textData: { text: String(text || ''), decorations: [] } };
}

function cell_(row, headerMap, header) {
  return headerMap[header] === undefined ? '' : row[headerMap[header]];
}

function getDailyTalkSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error("필수 시트 '" + name + "'를 찾을 수 없습니다.");
  return sheet;
}
