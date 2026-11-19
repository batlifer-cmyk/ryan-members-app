/**
 * Wix CMS publication of Ryan Daily Talk content.
 *
 * The site serves Daily Talk at /rm-magazine/{slug} from the CMS collection
 * RyanDailyTalkContent, so these tests pin:
 *   - the queue -> CMS field mapping (name for name),
 *   - the slug / publishDate rules taken from the live items,
 *   - insert on a free slug and patch on an existing one (wix-data/v2),
 *   - error handling that never leaks the API key,
 *   - the queue write-back of WIX_CONTENT_URL / WIX_POST_ID / WIX_PUBLISHED_AT.
 */

const FAKE_KEY = ['dummy', 'wix', 'credential', 'value'].join('-');

const ITEM = {
  contentId: 'SMALL_TALK-20261119-making-lunch-plans',
  sendDate: '2026-11-19',
  track: 'SMALL_TALK',
  level: 'BASIC',
  status: 'TEST',
  topicEn: 'Making Lunch Plans',
  topicKo: '점심 약속 잡기',
  snackEn: "When you're at work, lunch is an easy small talk topic.",
  snackKo: '직장에서 점심은 가볍게 대화하기 좋은 주제예요.',
  chunksJson: JSON.stringify([
    { en: "I'm thinking of getting lunch soon.", ko: '저 곧 점심 먹으러 갈까 해요.' },
    { en: 'That sounds good to me.', ko: '저는 좋아요.' },
    { en: 'Do you have any plans?', ko: '무슨 계획 있어요?' }
  ]),
  modelEn: "A: I'm thinking of getting lunch soon.\nB: That sounds good to me.",
  modelKo: 'A: 저 곧 점심 먹으러 갈까 해요.\nB: 저는 좋아요.',
  yourTurnEn: 'Ask one coworker about lunch today.',
  yourTurnKo: '오늘 동료 한 명에게 점심 계획을 물어보세요.',
  sources: 'OPENAI:gpt-5.5',
  kakaoText: '',
  wixContentUrl: '',
  wixPostId: '',
  wixPublishedAt: ''
};

const BUSINESS_ITEM = {
  contentId: 'BUSINESS-20261119-updating-the-team',
  track: 'BUSINESS',
  level: 'INTERMEDIATE',
  topicEn: 'Updating the team on a delay',
  topicKo: '팀에 일정 지연 알리기',
  chunksJson: '[{"en":"push the deadline","ko":"마감을 미루다"}]',
  modelEn: 'We may need to push the deadline by a day.',
  modelKo: '마감을 하루 미뤄야 할 것 같습니다.',
  yourTurnEn: 'Tell your team about a small delay.',
  yourTurnKo: '팀에 작은 지연을 알려 보세요.',
  sources: 'OPENAI:gpt-5.5'
};

// --- stub plumbing ---------------------------------------------------------

function withServiceStubs(stubs, fn) {
  const merged = Object.assign({ Utilities: fakeUtilities() }, stubs || {});
  const applied = Object.keys(merged);
  const previous = {};
  applied.forEach((key) => {
    previous[key] = global.__sandbox[key];
    global.__sandbox[key] = merged[key];
  });
  try {
    return fn();
  } finally {
    applied.forEach((key) => {
      if (previous[key] === undefined) delete global.__sandbox[key];
      else global.__sandbox[key] = previous[key];
    });
  }
}

function fakeUtilities() {
  let counter = 0;
  return {
    getUuid: () => 'uuid-' + (++counter),
    formatDate: (date, timezone, pattern) => {
      const iso = new Date(date).toISOString().slice(0, 10);
      return pattern === 'yyyy-MM-dd' ? iso : iso;
    }
  };
}

function fakeProperties(values) {
  return {
    getScriptProperties: () => ({
      getProperty: (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null),
      setProperty: () => {}
    })
  };
}

function fakeResponse(code, body) {
  return {
    getResponseCode: () => code,
    getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

/** Records every UrlFetchApp call and answers from a queue of [code, body]. */
function fakeUrlFetch(answers) {
  const calls = [];
  const pending = answers.slice();
  return {
    calls,
    fetch(url, options) {
      calls.push({ url, options });
      const next = pending.length > 1 ? pending.shift() : pending[0];
      if (!next) throw new Error('unexpected fetch: ' + url);
      return fakeResponse(next[0], next[1]);
    }
  };
}

function parseBody(call) {
  return JSON.parse(call.options.payload);
}

function stubSheet() {
  const cells = {};
  return {
    cells,
    getRange(row, column) {
      return {
        setValue(value) {
          cells[`${row}:${column}`] = value;
        }
      };
    }
  };
}

// --- field mapping ---------------------------------------------------------

describe('Daily Talk CMS payload', () => {
  test('maps every queue field to its RyanDailyTalkContent field name', () => {
    const data = buildDailyTalkCmsData_(ITEM, { slug: 'small-talk-2026-11-19-making-lunch-plans' });
    assert.equal(data.contentId, ITEM.contentId, 'contentId');
    assert.equal(data.topicEn, ITEM.topicEn, 'TOPIC_EN -> topicEn');
    assert.equal(data.topicKo, ITEM.topicKo, 'TOPIC_KO -> topicKo');
    assert.equal(data.snackEn, ITEM.snackEn, 'SNACK_EN -> snackEn');
    assert.equal(data.snackKo, ITEM.snackKo, 'SNACK_KO -> snackKo');
    assert.equal(data.modelAnswerEn, ITEM.modelEn, 'MODEL_EN -> modelAnswerEn');
    assert.equal(data.modelAnswerKo, ITEM.modelKo, 'MODEL_KO -> modelAnswerKo');
    assert.equal(data.yourTurnEn, ITEM.yourTurnEn, 'YOUR_TURN_EN -> yourTurnEn');
    assert.equal(data.yourTurnKo, ITEM.yourTurnKo, 'YOUR_TURN_KO -> yourTurnKo');
    assert.ok(data.kakaoText.indexOf('점심 약속 잡기') !== -1, '카카오본문 -> kakaoText');
    assert.equal(data.generatedByAi, true, 'SOURCES OPENAI -> generatedByAi');
    assert.equal(data.status, 'PUBLISHED', 'status');
    assert.equal(data.track, 'SMALL_TALK', 'track');
    assert.equal(data.level, 'BASIC', 'level');
  });

  test('never sends a field the collection does not declare', () => {
    const data = buildDailyTalkCmsData_(ITEM, { slug: 'small-talk-2026-11-19-making-lunch-plans' });
    const allowed = [
      'contentId', 'slug', 'title', 'track', 'level', 'status', 'publishDate', 'magazineUrl',
      'topicEn', 'topicKo', 'snackEn', 'snackKo', 'chunksJson', 'modelAnswerEn', 'modelAnswerKo',
      'yourTurnEn', 'yourTurnKo', 'sourceUrls', 'contentRich', 'contentHtml', 'kakaoText', 'generatedByAi'
    ];
    Object.keys(data).forEach((key) => {
      assert.ok(allowed.indexOf(key) !== -1, `unexpected CMS field: ${key}`);
    });
    ['modelEn', 'modelKo', 'chunks', '카카오본문'].forEach((rawName) => {
      assert.ok(!Object.prototype.hasOwnProperty.call(data, rawName), `queue-only name leaked: ${rawName}`);
    });
  });

  test('publishDate comes from CONTENT_ID as YYYY-MM-DD', () => {
    assert.equal(buildDailyTalkCmsData_(ITEM).publishDate, '2026-11-19');
    assert.equal(buildDailyTalkCmsData_({ contentId: 'X', sendDate: '2026-08-10' }).publishDate, '2026-08-10');
    assert.equal(buildDailyTalkCmsData_({ sendDate: '2026. 8. 10' }).publishDate, '2026-08-10');
  });

  test('chunksJson is normalized to an [{en, ko}] JSON array', () => {
    const data = buildDailyTalkCmsData_(ITEM);
    const chunks = JSON.parse(data.chunksJson);
    assert.equal(chunks.length, 3);
    assert.deepEqual(chunks[0], { en: "I'm thinking of getting lunch soon.", ko: '저 곧 점심 먹으러 갈까 해요.' });
    const fromLines = JSON.parse(buildDailyTalkCmsData_({ chunksJson: 'stay late: 야근하다\nwrap up: 마무리하다' }).chunksJson);
    assert.deepEqual(fromLines, [{ en: 'stay late', ko: '야근하다' }, { en: 'wrap up', ko: '마무리하다' }]);
    assert.equal(buildDailyTalkCmsData_({ chunksJson: '' }).chunksJson, '[]');
  });

  test('title follows the existing "[Small Talk] 주제" pattern', () => {
    assert.equal(buildDailyTalkCmsData_(ITEM).title, '[Small Talk] 점심 약속 잡기');
    assert.equal(buildDailyTalkCmsData_(BUSINESS_ITEM).title, '[Business Talk] 팀에 일정 지연 알리기');
  });

  test('contentRich carries every section the live page renders', () => {
    const rich = buildDailyTalkCmsData_(ITEM).contentRich;
    assert.ok(Array.isArray(rich.nodes));
    const texts = rich.nodes.map((node) => node.nodes[0].textData.text);
    assert.includes(texts, 'Making Lunch Plans');
    assert.includes(texts, '점심 약속 잡기');
    assert.includes(texts, 'Today’s Language Snack');
    assert.includes(texts, 'Useful Chunks');
    assert.includes(texts, 'Model Answer');
    assert.includes(texts, 'Your Turn');
    assert.includes(texts, "I'm thinking of getting lunch soon.: 저 곧 점심 먹으러 갈까 해요.");
    const heading = rich.nodes[0];
    assert.equal(heading.type, 'HEADING');
    assert.equal(heading.headingData.level, 2);
    assert.equal(heading.headingData.textStyle.textAlignment, 'AUTO');
    assert.equal(heading.nodes[0].type, 'TEXT');
    assert.deepEqual(heading.nodes[0].textData.decorations, []);
    const paragraph = rich.nodes[1];
    assert.equal(paragraph.type, 'PARAGRAPH');
    assert.equal(paragraph.paragraphData.textStyle.textAlignment, 'AUTO');
  });

  test('contentHtml mirrors the rich content and escapes markup', () => {
    const html = buildDailyTalkCmsData_({ topicEn: 'Use <b>bold</b> & "quotes"', topicKo: '한글' }).contentHtml;
    assert.includes(html, '<h2>Use &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot;</h2>');
    assert.includes(html, '<p class="topic-ko">한글</p>');
  });

  test('kakaoText links to the magazine item and keeps the opt-out footer', () => {
    const data = buildDailyTalkCmsData_(ITEM, { slug: 'small-talk-2026-11-19-making-lunch-plans' });
    assert.equal(data.magazineUrl, 'https://www.ryanmembers.com/rm-magazine/small-talk-2026-11-19-making-lunch-plans');
    assert.includes(data.kakaoText, '(광고)');
    assert.includes(data.kakaoText, data.magazineUrl);
    assert.includes(data.kakaoText, '수신거부');
  });

  test('an existing 카카오본문 in the queue wins over the generated body', () => {
    const data = buildDailyTalkCmsData_(Object.assign({}, ITEM, { kakaoText: '미리 쓴 본문' }));
    assert.equal(data.kakaoText, '미리 쓴 본문');
  });
});

// --- slug ------------------------------------------------------------------

describe('Daily Talk CMS slug', () => {
  test('derives {track}-{date}-{topic} from a generated CONTENT_ID', () => {
    assert.equal(buildDailyTalkCmsSlug_(ITEM), 'small-talk-2026-11-19-making-lunch-plans');
    assert.equal(buildDailyTalkCmsSlug_(BUSINESS_ITEM), 'business-talk-2026-11-19-updating-the-team');
  });

  test('matches the shape of the slugs already in the collection', () => {
    const slug = buildDailyTalkCmsSlug_({
      contentId: 'SMALL_TALK-20260724-surf-fashion',
      track: 'SMALL_TALK'
    });
    assert.equal(slug, 'small-talk-2026-07-24-surf-fashion');
  });

  test('falls back to the topic, then to a constant, and stays URL safe', () => {
    assert.equal(buildDailyTalkCmsSlug_({ track: 'BUSINESS', dateKey: '2026-11-19', topicEn: 'Updating the team!' }), 'business-talk-2026-11-19-updating-the-team');
    assert.equal(buildDailyTalkCmsSlug_({ contentId: 'X', dateKey: '2026-11-19' }), 'small-talk-2026-11-19-x');
    assert.equal(buildDailyTalkCmsSlug_({ dateKey: '2026-11-19' }), 'small-talk-2026-11-19-daily-talk');
    const koreanOnly = buildDailyTalkCmsSlug_({ contentId: 'SMALL_TALK-20261119-점심', topicEn: '점심 약속', dateKey: '2026-11-19' });
    assert.equal(koreanOnly, 'small-talk-2026-11-19-daily-talk');
    assert.match(koreanOnly, /^[a-z0-9-]+$/);
  });

  test('a slug stored on the row is used as is', () => {
    assert.equal(buildDailyTalkCmsSlug_({ slug: 'small-talk-2026-08-10-test-small-talk-sample' }), 'small-talk-2026-08-10-test-small-talk-sample');
  });
});

// --- publication ------------------------------------------------------------

describe('publishDailyTalkToWix_ (CMS)', () => {
  const settings = {
    WIX_PUBLICATION_MODE: 'CMS_MAGAZINE',
    WIX_SITE_ID: '77af5a69-40e6-48a1-a727-03aee59a6da4',
    WIX_CMS_COLLECTION_ID: 'RyanDailyTalkContent',
    WIX_MAGAZINE_BASE_URL: 'https://www.ryanmembers.com/rm-magazine'
  };

  test('mode defaults to CMS even when 설정 has no WIX_PUBLICATION_MODE', () => {
    assert.equal(resolveWixPublicationMode_({}), 'CMS_MAGAZINE');
    assert.equal(resolveWixPublicationMode_({ WIX_PUBLICATION_MODE: 'blog' }), 'BLOG');
    assert.equal(resolveWixPublicationMode_({ WIX_PUBLICATION_MODE: 'CMS_MAGAZINE' }), 'CMS_MAGAZINE');
  });

  test('inserts a new item and returns the magazine URL and CMS id', () => {
    const urlFetch = fakeUrlFetch([
      [200, { dataItems: [] }],
      [200, { dataItem: { id: 'cms-item-1', data: { slug: 'small-talk-2026-11-19-making-lunch-plans' } } }]
    ]);
    const result = withServiceStubs({
      PropertiesService: fakeProperties({ WIX_API_KEY: FAKE_KEY }),
      UrlFetchApp: urlFetch
    }, () => publishDailyTalkToWix_(ITEM, settings));

    assert.equal(result.postId, 'cms-item-1');
    assert.equal(result.url, 'https://www.ryanmembers.com/rm-magazine/small-talk-2026-11-19-making-lunch-plans');
    assert.equal(result.publishedMode, 'CMS_MAGAZINE');
    assert.ok(result.publishedAt instanceof Date);

    assert.equal(urlFetch.calls.length, 2);
    const [query, insert] = urlFetch.calls;
    assert.equal(query.options.method, 'post');
    assert.includes(query.url, 'https://www.wixapis.com/wix-data/v2/items/query');
    assert.equal(insert.url, 'https://www.wixapis.com/wix-data/v2/items');
    assert.equal(insert.options.headers.Authorization, FAKE_KEY);
    assert.equal(insert.options.headers['wix-site-id'], settings.WIX_SITE_ID);
    assert.equal(insert.options.contentType, 'application/json');

    const body = parseBody(insert);
    assert.equal(body.dataCollectionId, 'RyanDailyTalkContent');
    assert.equal(body.dataItem.data.slug, 'small-talk-2026-11-19-making-lunch-plans');
    assert.equal(body.dataItem.data.status, 'PUBLISHED');
    assert.ok(body.dataItem.data.contentRich.nodes.length > 5);
  });

  test('queries by slug before writing, so a rerun never duplicates the item', () => {
    const urlFetch = fakeUrlFetch([
      [200, { dataItems: [{ id: 'existing-1', data: { slug: 'small-talk-2026-11-19-making-lunch-plans' } }] }],
      [200, { dataItem: { id: 'existing-1', data: { slug: 'small-talk-2026-11-19-making-lunch-plans' } } }]
    ]);
    const result = withServiceStubs({
      PropertiesService: fakeProperties({ WIX_API_KEY: FAKE_KEY }),
      UrlFetchApp: urlFetch
    }, () => publishDailyTalkToWix_(ITEM, settings));

    assert.equal(result.postId, 'existing-1');
    assert.equal(urlFetch.calls.length, 2);
    const queryBody = parseBody(urlFetch.calls[0]);
    assert.deepEqual(queryBody.query.filter, { slug: 'small-talk-2026-11-19-making-lunch-plans' });
    assert.equal(queryBody.query.paging.limit, 1);

    const patch = urlFetch.calls[1];
    assert.equal(patch.options.method, 'patch');
    assert.includes(patch.url, '/items/existing-1');
    const patchBody = parseBody(patch);
    assert.equal(patchBody.patch.dataItemId, 'existing-1');
    const fields = patchBody.patch.fieldModifications.map((field) => field.fieldPath);
    assert.includes(fields, 'topicEn');
    assert.includes(fields, 'contentRich');
    assert.includes(fields, 'kakaoText');
    patchBody.patch.fieldModifications.forEach((field) => {
      assert.equal(field.action, 'SET_FIELD');
    });
  });

  test('a Wix error surfaces with status and body but never the API key', () => {
    const urlFetch = fakeUrlFetch([
      [200, { dataItems: [] }],
      [401, { message: 'UNAUTHENTICATED: ' + FAKE_KEY + ' is not valid' }]
    ]);
    let error = null;
    try {
      withServiceStubs({
        PropertiesService: fakeProperties({ WIX_API_KEY: FAKE_KEY }),
        UrlFetchApp: urlFetch
      }, () => publishDailyTalkToWix_(ITEM, settings));
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, 'expected the publish to fail');
    assert.includes(error.message, '실패 (401)');
    assert.excludes(error.message, FAKE_KEY, 'the API key must not appear in the error');
  });

  test('a 200 answer without an item id is treated as a failure', () => {
    const urlFetch = fakeUrlFetch([
      [200, { dataItems: [] }],
      [200, { dataItem: { data: { slug: 'small-talk-2026-11-19-making-lunch-plans' } } }]
    ]);
    let error = null;
    try {
      withServiceStubs({
        PropertiesService: fakeProperties({ WIX_API_KEY: FAKE_KEY }),
        UrlFetchApp: urlFetch
      }, () => publishDailyTalkToWix_(ITEM, settings));
    } catch (caught) {
      error = caught;
    }
    assert.ok(error && /item id/.test(error.message), 'expected a missing-id error');
  });

  test('a wrong slug in the response is caught before the queue records a URL', () => {
    const urlFetch = fakeUrlFetch([
      [200, { dataItems: [] }],
      [200, { dataItem: { id: 'cms-item-2', data: { slug: 'something-else' } } }]
    ]);
    let error = null;
    try {
      withServiceStubs({
        PropertiesService: fakeProperties({ WIX_API_KEY: FAKE_KEY }),
        UrlFetchApp: urlFetch
      }, () => publishDailyTalkToWix_(ITEM, settings));
    } catch (caught) {
      error = caught;
    }
    assert.ok(error && /슬러그/.test(error.message), 'expected a slug mismatch error');
  });

  test('a missing WIX_API_KEY fails before any Wix call', () => {
    const urlFetch = fakeUrlFetch([[200, {}]]);
    let error = null;
    try {
      withServiceStubs({
        PropertiesService: fakeProperties({}),
        UrlFetchApp: urlFetch
      }, () => publishDailyTalkToWix_(ITEM, settings));
    } catch (caught) {
      error = caught;
    }
    assert.ok(error && /WIX_API_KEY/.test(error.message));
    assert.equal(urlFetch.calls.length, 0);
  });

  test('WIX_PUBLICATION_MODE=BLOG keeps the old Blog API path', () => {
    const urlFetch = fakeUrlFetch([[200, { draftPost: { id: 'post-1', url: { base: 'https://www.ryanmembers.com', path: '/post/daily-talk' } } }]]);
    const result = withServiceStubs({
      PropertiesService: fakeProperties({ WIX_API_KEY: FAKE_KEY }),
      UrlFetchApp: urlFetch
    }, () => publishDailyTalkToWix_(ITEM, Object.assign({}, settings, { WIX_PUBLICATION_MODE: 'BLOG' })));
    assert.includes(urlFetch.calls[0].url, '/blog/v3/draft-posts');
    assert.equal(result.url, 'https://www.ryanmembers.com/post/daily-talk');
  });
});

// --- queue write-back -------------------------------------------------------

describe('publish result in 콘텐츠대기열', () => {
  test('writes WIX_CONTENT_URL, WIX_POST_ID, WIX_PUBLISHED_AT and 카카오본문', () => {
    const sheet = stubSheet();
    const headerUnit = { WIX_CONTENT_URL: 20, WIX_POST_ID: 21, WIX_PUBLISHED_AT: 22, 카카오본문: 16 };
    const publishedAt = new Date('2026-11-19T10:00:00Z');
    writeQueuePublishingResult_(sheet, headerUnit, 5, {
      url: 'https://www.ryanmembers.com/rm-magazine/small-talk-2026-11-19-making-lunch-plans',
      postId: 'cms-item-1',
      publishedAt: publishedAt,
      kakaoText: '본문'
    });
    assert.equal(sheet.cells['5:20'], 'https://www.ryanmembers.com/rm-magazine/small-talk-2026-11-19-making-lunch-plans');
    assert.equal(sheet.cells['5:21'], 'cms-item-1');
    assert.equal(sheet.cells['5:22'], publishedAt);
    assert.equal(sheet.cells['5:16'], '본문');
  });

  test('keeps a usable body when the publisher has no kakaoText', () => {
    const sheet = stubSheet();
    writeQueuePublishingResult_(sheet, { 카카오본문: 16 }, 2, {
      url: 'https://www.ryanmembers.com/rm-magazine/x',
      postId: 'id',
      publishedAt: new Date()
    });
    assert.includes(sheet.cells['2:16'], 'https://www.ryanmembers.com/rm-magazine/x');
  });

  test('the published magazine URL passes the send-time URL guard', () => {
    assert.equal(isValidWixPostUrl('https://www.ryanmembers.com/rm-magazine/small-talk-2026-11-19-making-lunch-plans'), true);
    assert.equal(isValidWixPostUrl('https://www.ryanmembers.com/rm-magazine'), false);
    assert.equal(isValidWixPostUrl('https://www.ryanmembers.com/rm-magazine/'), false);
  });
});
