const fs = require('fs');
const path = require('path');

describe('normalizePhone', () => {
  test('formats 11-digit 010 digits with dashes', () => {
    assert.equal(normalizePhone('01012345678'), '010-1234-5678');
    assert.equal(normalizePhone('010-1234-5678'), '010-1234-5678');
    assert.equal(normalizePhone('010 1234 5678'), '010-1234-5678');
    assert.equal(normalizePhone('010.1234.5678'), '010-1234-5678');
    assert.equal(normalizePhone(' 010-１２３４-5678 '), '010-1234-5678');
  });

  test('accepts country-code forms', () => {
    assert.equal(normalizePhone('+82 10-1234-5678'), '010-1234-5678');
    assert.equal(normalizePhone('+821012345678'), '010-1234-5678');
    assert.equal(normalizePhone('821012345678'), '010-1234-5678');
    assert.equal(normalizePhone('0082 10 1234 5678'), '010-1234-5678');
  });

  test('formats legacy mobile prefixes seen in older contact rows', () => {
    assert.equal(normalizePhone('0111234567'), '011-123-4567');
    assert.equal(normalizePhone('01112345678'), '011-1234-5678');
  });

  test('rejects values that cannot be a Korean mobile number', () => {
    assert.equal(normalizePhone(''), '');
    assert.equal(normalizePhone(null), '');
    assert.equal(normalizePhone(undefined), '');
    assert.equal(normalizePhone('abc'), '');
    assert.equal(normalizePhone('051-123-4567'), '');
    assert.equal(normalizePhone('010-123-456'), '');
    assert.equal(normalizePhone('0101234567890'), '');
  });

  test('isValidPhone / isDailyTalkPhone agree with the normalized value', () => {
    assert.equal(isValidPhone('010-1234-5678'), true);
    assert.equal(isValidPhone('011-123-4567'), true);
    assert.equal(isDailyTalkPhone('011-123-4567'), false);
    assert.equal(isDailyTalkPhone('010-1234-5678'), true);
    assert.equal(isValidPhone('1234'), false);
  });

  test('maskPhone never exposes the full number', () => {
    assert.equal(maskPhone('010-1234-5678'), '***-****-5678');
    assert.equal(maskPhone('nope'), '***');
  });
});

const fixturePath = path.join(ROOT, 'tests', 'fixtures', 'contact-rows.json');
const contactFixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

describe('filterActiveRecipients (fixture: contact-rows.json)', () => {
  test('keeps only opted-in ACTIVE rows with a valid 010 number and a name', () => {
    const result = filterActiveRecipients(contactFixtures.records);
    const phones = result.recipients.map((recipient) => recipient.phone).sort();
    assert.deepEqual(phones, ['010-1111-2222', '010-3333-4444', '010-7777-8888']);
  });

  test('explains every rejection with a stable reason code', () => {
    const result = filterActiveRecipients(contactFixtures.records);
    const reasons = {};
    result.rejected.forEach((item) => { reasons[item.reason] = (reasons[item.reason] || 0) + 1; });
    assert.equal(reasons.NOT_OPTED_IN, 1, 'opt-out row must be rejected');
    assert.equal(reasons.INVALID_PHONE || reasons.NOT_MOBILE_010, 1, 'landline row must be rejected');
    assert.equal(reasons.DUPLICATE_PHONE, 1, 'duplicate phone must be dropped once');
    assert.equal(reasons.STATUS_PAUSED, 1, 'PAUSED status must not be sent');
  });

  test('the first occurrence of a duplicate phone wins and keeps its track', () => {
    const result = filterActiveRecipients(contactFixtures.records);
    const duplicated = result.recipients.find((recipient) => recipient.phone === '010-3333-4444');
    assert.ok(duplicated, 'expected duplicate fixture phone in the audience');
    assert.equal(duplicated.track, 'BUSINESS');
  });

  test('tolerates sheet booleans, blank cells and lowercase status', () => {
    const result = filterActiveRecipients([
      { rowNumber: 2, name: '김테스트', phone: '010-9999-0000', optIn: 'TRUE', track: 'both', status: 'active' }
    ]);
    assert.equal(result.recipients.length, 1);
    assert.equal(result.recipients[0].track, 'BOTH');
  });

  test('handles an empty list', () => {
    assert.deepEqual(filterActiveRecipients([]), { recipients: [], rejected: [] });
    assert.deepEqual(filterActiveRecipients(null), { recipients: [], rejected: [] });
  });
});

describe('selectRecipientsForTrack', () => {
  const recipients = [
    { name: 'A', phone: '010-1111-1111', track: 'SMALL_TALK' },
    { name: 'B', phone: '010-2222-2222', track: 'BUSINESS' },
    { name: 'C', phone: '010-3333-3333', track: 'BOTH' },
    { name: 'D', phone: '010-4444-4444', track: '' }
  ];

  test('SMALL_TALK reaches small-talk and both subscribers', () => {
    const phones = selectRecipientsForTrack(recipients, 'SMALL_TALK').map((r) => r.phone);
    assert.deepEqual(phones, ['010-1111-1111', '010-3333-3333', '010-4444-4444']);
  });

  test('BUSINESS reaches business and both subscribers', () => {
    const phones = selectRecipientsForTrack(recipients, 'BUSINESS').map((r) => r.phone);
    assert.deepEqual(phones, ['010-2222-2222', '010-3333-3333']);
  });

  test('an unknown track falls back to SMALL_TALK instead of sending to everyone', () => {
    const phones = selectRecipientsForTrack(recipients, 'NOPE').map((r) => r.phone);
    assert.deepEqual(phones, ['010-1111-1111', '010-3333-3333', '010-4444-4444']);
  });
});
