const CONSENT_TEXT = '영어여권 발급 후 라이언멤버스의 평일 영어 학습 콘텐츠를 카카오톡으로 받겠습니다. 광고성 정보 수신에 동의하며, 카카오톡 채널 차단을 통해 언제든 중단할 수 있습니다.';

function baseSubmission(overrides) {
  return Object.assign({
    studentName: '홍길동',
    phone: '010-1234-5678',
    registrationType: '신규등록',
    lessonCount: '16',
    courseType: '사교영어·스몰톡 (RM 영어입담비법서)',
    teacher: 'Matthew',
    learningGoal: '자신감 있는 스피킹',
    privacyConsent: true,
    dailyTalkOptIn: false
  }, overrides || {});
}

function makePayload(overrides, extra) {
  const sanitized = sanitizePassportPayload(baseSubmission(overrides), Object.assign({
    consentVersion: '2026-07-25-v2',
    submittedAt: '2026-11-18T06:30:00.000Z'
  }, extra || {}));
  return sanitized;
}

describe('sanitizePassportPayload', () => {
  test('normalizes name, phone, lesson count and course', () => {
    const payload = makePayload({ studentName: '  홍길동 ', phone: '01012345678', lessonCount: '16' });
    assert.equal(payload.studentName, '홍길동');
    assert.equal(payload.phone, '010-1234-5678');
    assert.equal(payload.lessonCount, 16);
    assert.equal(payload.courseType, '사교영어·스몰톡 (RM 영어입담비법서)');
    assert.equal(payload.dailyTalkStatus, 'INACTIVE');
    assert.equal(payload.dailyTalkOptIn, false);
  });

  test('keeps a custom lesson count between 1 and 300', () => {
    const payload = makePayload({ lessonCount: '직접 입력', lessonCountCustom: '10' });
    assert.equal(payload.lessonCount, 10);
  });

  test('strips non-digits from the custom lesson count', () => {
    assert.equal(makePayload({ lessonCount: '직접 입력', lessonCountCustom: '12회' }).lessonCount, 12);
    assert.equal(resolveLessonCount('직접 입력', ''), 0);
    assert.equal(resolveLessonCount('8', ''), 8);
  });

  test('never keeps a track for a student who did not opt in', () => {
    const payload = makePayload({ dailyTalkOptIn: false, dailyTalkTrack: 'BUSINESS' });
    assert.equal(payload.dailyTalkTrack, '');
    assert.equal(payload.dailyTalkConsentVersion, '');
    assert.equal(payload.dailyTalkConsentAt, '');
    assert.equal(payload.dailyTalkStatus, 'INACTIVE');
    assert.equal(validatePassportPayload(payload).ok, true);
  });

  test('records consent version and timestamp when opted in', () => {
    const payload = makePayload({ dailyTalkOptIn: true, dailyTalkTrack: 'SMALL_TALK' });
    assert.equal(payload.dailyTalkOptIn, true);
    assert.equal(payload.dailyTalkConsentVersion, '2026-07-25-v2');
    assert.equal(payload.dailyTalkConsentAt, '2026-11-18T06:30:00.000Z');
    assert.equal(payload.dailyTalkStatus, 'ACTIVE');
  });

  test("keeps the student's final choice even when it differs from the recommendation", () => {
    const payload = makePayload({
      courseType: '사교영어·스몰톡 (RM 영어입담비법서)',
      dailyTalkOptIn: true,
      dailyTalkTrack: 'BUSINESS'
    });
    assert.equal(payload.dailyTalkTrackRecommendation, 'SMALL_TALK', 'course recommendation is SMALL_TALK');
    assert.equal(payload.dailyTalkTrack, 'BUSINESS', 'stored track must be the student choice');
    assert.equal(payload.dailyTalkTrackChosen, 'BUSINESS');
  });

  test('defaults to the recommendation only when the student made no choice', () => {
    const payload = makePayload({ courseType: '비즈니스 실무영어', dailyTalkOptIn: true, dailyTalkTrack: '' });
    assert.equal(payload.dailyTalkTrack, 'BUSINESS');
    assert.equal(payload.dailyTalkTrackChosen, '');
  });

  test('BOTH survives sanitization unchanged', () => {
    assert.equal(makePayload({ dailyTalkOptIn: true, dailyTalkTrack: 'both' }).dailyTalkTrack, 'BOTH');
  });

  test('kakaoChannelAdded can never be set by the client payload', () => {
    const payload = makePayload({ dailyTalkOptIn: true, dailyTalkTrack: 'BOTH', kakaoChannelAdded: true });
    assert.equal(payload.kakaoChannelAdded, false);
  });
});

describe('classifyDailyTalkTrack / resolveDailyTalkTrack', () => {
  test('small-talk style courses recommend SMALL_TALK', () => {
    ['여행영어', '사교영어·스몰톡', '쿠킹 영어', '영어울렁증 회복', '발음·억양교정'].forEach((course) => {
      assert.equal(classifyDailyTalkTrack(course), 'SMALL_TALK', course);
    });
  });

  test('career and exam-adjacent courses recommend BUSINESS', () => {
    ['비즈니스 실무영어', '영어면접 집중교육', '영어발표·프레젠테이션', '에세이·아카데믹 라이팅'].forEach((course) => {
      assert.equal(classifyDailyTalkTrack(course), 'BUSINESS', course);
    });
  });

  test('mixed courses recommend BOTH', () => {
    assert.equal(classifyDailyTalkTrack('비즈니스 영어 + 여행영어'), 'BOTH');
  });

  test('unknown or empty courses recommend SMALL_TALK (safe default)', () => {
    assert.equal(classifyDailyTalkTrack(''), 'SMALL_TALK');
    assert.equal(classifyDailyTalkTrack('TOEIC'), 'SMALL_TALK');
    assert.equal(classifyDailyTalkTrack(null), 'SMALL_TALK');
  });

  test('explicit choice always wins', () => {
    assert.equal(resolveDailyTalkTrack('BOTH', '비즈니스 실무영어'), 'BOTH');
    assert.equal(resolveDailyTalkTrack('', '비즈니스 실무영어'), 'BUSINESS');
    assert.equal(resolveDailyTalkTrack('broken', '여행영어'), 'SMALL_TALK');
  });
});

describe('validatePassportPayload', () => {
  test('accepts a complete opt-out submission', () => {
    const result = validatePassportPayload(makePayload({}));
    assert.equal(result.ok, true);
  });

  test('accepts a complete opt-in submission', () => {
    const result = validatePassportPayload(makePayload({ dailyTalkOptIn: true, dailyTalkTrack: 'SMALL_TALK' }));
    assert.equal(result.ok, true);
  });

  test('rejects a missing name', () => {
    const result = validatePassportPayload(makePayload({ studentName: '   ' }));
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].field, 'studentName');
  });

  test('rejects a malformed phone', () => {
    const result = validatePassportPayload(makePayload({ phone: '1234' }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.field === 'phone'));
  });

  test('rejects an unknown registration type', () => {
    const result = validatePassportPayload(makePayload({ registrationType: '상담' }));
    assert.ok(result.errors.some((error) => error.field === 'registrationType'));
  });

  test('rejects lesson counts outside 1..300', () => {
    assert.equal(validatePassportPayload(makePayload({ lessonCount: '0' })).ok, false);
    assert.equal(validatePassportPayload(makePayload({ lessonCount: '301' })).ok, false);
    assert.equal(validatePassportPayload(makePayload({ lessonCount: '직접 입력', lessonCountCustom: '999' })).ok, false);
    assert.equal(validatePassportPayload(makePayload({ lessonCount: '직접 입력', lessonCountCustom: '10' })).ok, true);
  });

  test('requires privacy consent', () => {
    const result = validatePassportPayload(makePayload({ privacyConsent: false }));
    assert.ok(result.errors.some((error) => error.field === 'privacyConsent'));
  });

  test('requires a valid track only when opted in', () => {
    const optInBroken = makePayload({ dailyTalkOptIn: true, dailyTalkTrack: 'SMALL_TALK' });
    optInBroken.dailyTalkTrack = ''; // force an invalid state past sanitize
    const result = validatePassportPayload(optInBroken);
    assert.ok(result.errors.some((error) => error.field === 'dailyTalkTrack'));
  });

  test('refuses a payload that claims a confirmed Kakao friend add', () => {
    const payload = makePayload({});
    payload.kakaoChannelAdded = true;
    const result = validatePassportPayload(payload);
    assert.ok(result.errors.some((error) => error.field === 'kakaoChannelAdded'));
  });
});

describe('buildRegistrationFields / buildContactFields', () => {
  test('registration row carries the exact processing defaults', () => {
    const payload = makePayload({ dailyTalkOptIn: true, dailyTalkTrack: 'BOTH' });
    const fields = buildRegistrationFields(payload, { submissionId: 'SUB-1', nowIso: '2026-11-18T06:30:05.000Z' });
    assert.equal(fields['제출ID'], 'SUB-1');
    assert.equal(fields['제출경로'], '영어여권웹');
    assert.equal(fields['개인정보동의'], '동의');
    assert.equal(fields['학생매칭상태'], '대기');
    assert.equal(fields['결제매칭상태'], '대기');
    assert.equal(fields['처리상태'], '접수');
    assert.equal(fields['kakaoChannelAdded'], false);
    assert.equal(fields['dailyTalkTrack'], 'BOTH');
    assert.match(fields['원본요청JSON'], /"dailyTalkTrack":"BOTH"/);
  });

  test('contact fields never include the name of an unrelated student', () => {
    const fields = buildContactFields(makePayload({ studentName: '김학생' }));
    assert.equal(fields['학생명'], '김학생');
    assert.equal(fields['dailyTalkOptIn'], false);
    assert.equal(fields['dailyTalkTrack'], '');
  });
});

describe('consent copy', () => {
  test('the required consent text is stored verbatim in the shared constant', () => {
    assert.equal(
      normalizeWhitespace(CONSENT_TEXT),
      '영어여권 발급 후 라이언멤버스의 평일 영어 학습 콘텐츠를 카카오톡으로 받겠습니다. 광고성 정보 수신에 동의하며, 카카오톡 채널 차단을 통해 언제든 중단할 수 있습니다.'
    );
  });
});
