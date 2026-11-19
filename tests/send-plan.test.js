describe('buildSendPlan', () => {
  const audience = [
    { name: '김스몰', phone: '010-1111-1111', track: 'SMALL_TALK' },
    { name: '이비즈', phone: '010-2222-2222', track: 'BUSINESS' },
    { name: '박둘다', phone: '010-3333-3333', track: 'BOTH' }
  ];

  test('a BOTH subscriber appears once per track, but never twice for one content id', () => {
    const small = buildSendPlan([{ contentId: 'C1', track: 'SMALL_TALK', targets: audience }]);
    const business = buildSendPlan([{ contentId: 'C2', track: 'BUSINESS', targets: audience }]);

    assert.deepEqual(small.targets.map((t) => t.phone), ['010-1111-1111', '010-3333-3333']);
    assert.deepEqual(business.targets.map((t) => t.phone), ['010-2222-2222', '010-3333-3333']);

    const bothItems = buildSendPlan([
      { contentId: 'C1', track: 'SMALL_TALK', targets: audience },
      { contentId: 'C1', track: 'SMALL_TALK', targets: audience }
    ]);
    assert.equal(bothItems.targets.length, 2, 'duplicate content+phone must be collapsed inside one run');
    assert.equal(bothItems.skipped.filter((s) => s.reason === 'DUPLICATE_IN_RUN').length, 2);
  });

  test('already-sent content id + phone is skipped (idempotent re-run)', () => {
    const plan = buildSendPlan([{
      contentId: 'C1',
      track: 'SMALL_TALK',
      targets: audience,
      alreadySentKeys: [buildSendKey('C1', '010-1111-1111')]
    }]);
    assert.deepEqual(plan.targets.map((t) => t.phone), ['010-3333-3333']);
    assert.ok(plan.skipped.some((skip) => skip.reason === 'ALREADY_SENT' && skip.phone === '010-1111-1111'));
  });

  test('a different content id is not blocked by an earlier send', () => {
    const plan = buildSendPlan([{
      contentId: 'C2',
      track: 'SMALL_TALK',
      targets: audience,
      alreadySentKeys: [buildSendKey('C1', '010-1111-1111')]
    }]);
    assert.equal(plan.targets.length, 2);
  });

  test('respects the per-run recipient limit', () => {
    const many = [];
    for (let i = 0; i < 10; i += 1) {
      many.push({ name: 'S' + i, phone: '010-0000-' + String(1000 + i), track: 'SMALL_TALK' });
    }
    const plan = buildSendPlan([{ contentId: 'C1', track: 'SMALL_TALK', targets: many }], { maxRecipients: 3 });
    assert.equal(plan.targets.length, 3);
    assert.equal(plan.skipped.filter((s) => s.reason === 'RECIPIENT_LIMIT').length, 7);
  });

  test('accepts an empty plan', () => {
    assert.deepEqual(buildSendPlan([]), { targets: [], skipped: [] });
  });

  test('accepts the send-log key map returned by readSendLogIndex_', () => {
    const keyMap = {};
    keyMap[buildSendKey('C1', '010-1111-1111')] = true;
    keyMap[buildSendKey('C1', '010-2222-2222')] = false;
    const plan = buildSendPlan([{
      contentId: 'C1',
      track: 'SMALL_TALK',
      targets: audience,
      alreadySentKeys: keyMap
    }]);
    assert.deepEqual(plan.targets.map((t) => t.phone), ['010-3333-3333']);
    assert.ok(plan.skipped.some((skip) => skip.reason === 'ALREADY_SENT' && skip.phone === '010-1111-1111'));
  });
});

describe('buildAlreadySentKeySet', () => {
  test('only successful log rows block a resend', () => {
    const keys = buildAlreadySentKeySet([
      { contentId: 'C1', phone: '010-1111-1111', status: 'SENT' },
      { contentId: 'C1', phone: '010-2222-2222', status: 'FAILED' },
      { contentId: 'C1', phone: '010-3333-3333', status: 'ACCEPTED' }
    ]);
    assert.equal(keys[buildSendKey('C1', '010-1111-1111')], true);
    assert.equal(keys[buildSendKey('C1', '010-3333-3333')], true);
    assert.equal(keys[buildSendKey('C1', '010-2222-2222')], undefined);
  });
});

describe('parseSolapiResponse', () => {
  test('marks only statusCode 2000 as sent', () => {
    const result = parseSolapiResponse({
      groupInfo: { count: { registeredSuccess: 1, registeredFailed: 1 } },
      messageList: [
        { to: '01011111111', statusCode: 2000, messageId: 'M-1' },
        { to: '01022222222', statusCode: 4000, statusMessage: '차단된 수신자', messageId: 'M-2' }
      ]
    }, ['010-1111-1111', '010-2222-2222']);

    assert.equal(result.verified, true);
    const success = result.results.find((r) => r.phone === '010-1111-1111');
    const failure = result.results.find((r) => r.phone === '010-2222-2222');
    assert.equal(success.ok, true);
    assert.equal(success.messageId, 'M-1');
    assert.equal(failure.ok, false);
    assert.equal(failure.status, 'FAILED');
    assert.equal(failure.reason, '차단된 수신자');
  });

  test('keeps pending codes out of the success bucket', () => {
    const result = parseSolapiResponse({
      messageList: [{ to: '01011111111', statusCode: 3000, messageId: 'M-3' }]
    }, ['010-1111-1111']);
    assert.equal(result.results[0].ok, false);
    assert.equal(result.results[0].status, 'PENDING');
  });

  test('flags a recipient missing from the provider response as failed', () => {
    const result = parseSolapiResponse({
      messageList: [{ to: '01011111111', statusCode: 2000 }]
    }, ['010-1111-1111', '010-2222-2222']);
    const missing = result.results.find((r) => r.phone === '010-2222-2222');
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, 'NOT_IN_RESPONSE');
  });

  test('an unverifiable HTTP 200 body never counts as success', () => {
    const result = parseSolapiResponse({ groupInfo: { count: { registeredSuccess: 2 } } }, ['010-1111-1111', '010-2222-2222']);
    assert.equal(result.verified, false);
    assert.equal(result.results.every((r) => r.ok === false), true);
    assert.equal(result.results[0].reason, 'NO_MESSAGE_LIST');
  });

  test('pairs by send order when SOLAPI omits the recipient number', () => {
    // Real 2026-11-19 response shape: messageId/statusCode/customFields only, no `to`.
    const result = parseSolapiResponse({
      groupInfo: { _id: 'G4V20261119170024XRFLZEECO4WRR31', count: { registeredSuccess: 2 } },
      messageList: [
        { messageId: 'M-1', statusCode: '2000', statusMessage: '정상 접수' },
        { messageId: 'M-2', statusCode: '2000', statusMessage: '정상 접수' }
      ]
    }, ['010-1111-1111', '010-2222-2222']);

    assert.equal(result.verified, true);
    assert.equal(result.pairedByIndex, true);
    assert.equal(result.groupId, 'G4V20261119170024XRFLZEECO4WRR31');
    const first = result.results.find((r) => r.phone === '010-1111-1111');
    const second = result.results.find((r) => r.phone === '010-2222-2222');
    assert.equal(first.ok, true);
    assert.equal(first.messageId, 'M-1');
    assert.equal(second.ok, true);
    assert.equal(second.messageId, 'M-2');
  });

  test('does not pair by order when the counts differ or a real failure is returned', () => {
    const short = parseSolapiResponse({
      messageList: [{ messageId: 'M-1', statusCode: '2000' }]
    }, ['010-1111-1111', '010-2222-2222']);
    assert.equal(short.results.every((r) => r.ok === false), true);
    assert.equal(short.results[0].reason, 'NOT_IN_RESPONSE');

    const failed = parseSolapiResponse({
      failedMessageList: [{ to: '01022222222', statusCode: '3001', statusMessage: '카카오 친구 아님' }],
      messageList: [{ messageId: 'M-1', statusCode: '2000' }]
    }, ['010-1111-1111', '010-2222-2222']);
    assert.equal(failed.results.find((r) => r.phone === '010-2222-2222').ok, false);
  });

  test('accepts a JSON string body', () => {
    const result = parseSolapiResponse(JSON.stringify({ messageList: [{ to: '01011111111', statusCode: 2000 }] }), ['010-1111-1111']);
    assert.equal(result.results[0].ok, true);
  });
});

describe('Wix URL and Kakao message body', () => {
  test('accepts a real Wix post URL and rejects the category page', () => {
    assert.equal(isValidWixPostUrl('https://www.ryanmembers.com/post/daily-talk-2026-11-18'), true);
    assert.equal(isValidWixPostUrl('https://ryanmembers.com/blog/post/hello'), true);
    assert.equal(isValidWixPostUrl('https://www.ryanmembers.com/blog/categories/daily-talk'), false);
    assert.equal(isValidWixPostUrl(''), false);
    assert.equal(isValidWixPostUrl('javascript:alert(1)'), false);
    assert.equal(isValidWixPostUrl('https://evil.example.com/post/x'), false);
  });

  test('message body carries the ad label, the link and the opt-out footer', () => {
    const text = buildKakaoMessageText({
      topicKo: '커피 주문하기',
      wixContentUrl: 'https://www.ryanmembers.com/post/daily-talk-2026-11-18'
    });
    assert.includes(text, '(광고)');
    assert.includes(text, '커피 주문하기');
    assert.includes(text, 'https://www.ryanmembers.com/post/daily-talk-2026-11-18');
    assert.includes(text, '수신거부: 카카오톡에서 라이언멤버스 채널을 차단해 주세요.');
    assert.ok(text.split('\n').length >= 5);
  });
});

describe('resolveColumnMap', () => {
  const registrationSpec = [
    { field: '제출ID', aliases: ['submissionId'], required: true },
    { field: '제출일시', aliases: ['submittedAt'], required: true },
    { field: '학생명', aliases: ['이름', 'studentName'], required: true },
    { field: '전화번호', aliases: ['휴대전화번호', 'phone'], required: true },
    { field: '신청회차', aliases: ['lessonCount'], required: true },
    { field: 'dailyTalkOptIn', aliases: [], required: false },
    { field: 'dailyTalkTrack', aliases: [], required: false },
    { field: 'kakaoChannelClickAt', aliases: [], required: false }
  ];

  test('finds columns by exact and alias header names', () => {
    const result = resolveColumnMap(['제출ID', '제출일시', '학생명', '휴대전화번호', '신청회차', 'dailyTalkOptIn'], registrationSpec);
    assert.equal(result.map['제출ID'], 1);
    assert.equal(result.map['전화번호'], 4);
    assert.equal(result.map['dailyTalkOptIn'], 6);
  });

  test('appends missing optional columns after the last header instead of reusing one', () => {
    const headers = ['제출ID', '제출일시', '학생명', '휴대전화번호', '신청회차', 'dailyTalkOptIn', 'dailyTalkTrack'];
    const result = resolveColumnMap(headers, registrationSpec);
    assert.equal(result.map['kakaoChannelClickAt'], 8);
    assert.deepEqual(result.missing, ['kakaoChannelClickAt']);
  });

  test('ignores header order, so a reordered sheet still maps correctly', () => {
    const result = resolveColumnMap(['전화번호', '신청회차', '제출일시', '학생명', '제출ID'], registrationSpec);
    assert.equal(result.map['전화번호'], 1);
    assert.equal(result.map['학생명'], 4);
    assert.equal(result.map['제출ID'], 5);
  });

  test('buildRowValues places values at the mapped 1-based columns', () => {
    const result = resolveColumnMap(['제출ID', '학생명', '휴대전화번호'], registrationSpec);
    const row = buildRowValues(result.map, { '제출ID': 'X-1', '학생명': '홍길동', '전화번호': '010-1234-5678' }, result.headerCount);
    assert.equal(row[0], 'X-1');
    assert.equal(row[1], '홍길동');
    assert.equal(row[2], '010-1234-5678');
    assert.equal(row.length, result.headerCount, 'row width must follow the header width');
  });
});
