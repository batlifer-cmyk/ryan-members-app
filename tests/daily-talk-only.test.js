/**
 * Standalone Ryan Daily Talk sign-up / track change (`?dailytalk=1`).
 *
 * Two layers are pinned here:
 *  1. the pure sanitize / validate / field-builder functions in PassportCore.gs,
 *  2. the storage path of submitDailyTalkOnly() against a fake `학생연락처`
 *     sheet — the promise that matters to the owner is that `_DB_등록신청` is
 *     never written and that a track change leaves every other cell alone.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONTACT_SHEET = '학생연락처';
const REGISTRATION_SHEET = '_DB_등록신청';
const CONTACT_HEADERS = [
  '', '학생명', '전화번호', '수동입력', 'dailyTalkOptIn', 'dailyTalkTrack',
  'dailyTalkConsentAt', 'dailyTalkConsentVersion', 'kakaoChannelAdded',
  'dailyTalkStatus', 'lastDailyTalkSentAt', 'kakaoChannelClickAt',
  'kakaoChannelAddedAt', '등록상태'
];

// Load the storage layer into the same sandbox the other suites use.
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'apps-script', 'EnglishPassportBackend.gs'), 'utf8'),
  global.__sandbox,
  { filename: 'apps-script/EnglishPassportBackend.gs' }
);
['submitDailyTalkOnly', 'getDailyTalkOnlyConfig'].forEach((name) => {
  global[name] = global.__sandbox[name];
});

function makeSheet(name, headers, rows) {
  const grid = [headers.slice()].concat((rows || []).map((row) => row.slice()));
  const writes = [];
  const cells = [];
  function ensure(row, col) {
    while (grid.length < row) grid.push([]);
    const line = grid[row - 1];
    while (line.length < col) line.push('');
  }
  function lastRow() {
    let last = 0;
    grid.forEach((line, index) => {
      if (line.some((value) => String(value === undefined || value === null ? '' : value).trim() !== '')) last = index + 1;
    });
    return last;
  }
  function lastColumn() {
    let max = 0;
    grid.forEach((line) => {
      for (let i = line.length - 1; i >= 0; i -= 1) {
        if (String(line[i] === undefined || line[i] === null ? '' : line[i]).trim() !== '') {
          max = Math.max(max, i + 1);
          break;
        }
      }
    });
    return max;
  }
  return {
    getName: () => name,
    getLastRow: lastRow,
    getLastColumn: lastColumn,
    getMaxRows: () => Math.max(grid.length, 100),
    getMaxColumns: () => Math.max(lastColumn(), 26),
    insertRowsAfter() {},
    insertColumnsAfter() {},
    appendRow(values) {
      grid.push(values.slice());
    },
    getRange(row, col, numRows, numCols) {
      const rowCount = numRows || 1;
      const colCount = numCols || 1;
      return {
        getValue() {
          const line = grid[row - 1] || [];
          return line[col - 1] === undefined ? '' : line[col - 1];
        },
        setValue(value) {
          ensure(row, col);
          grid[row - 1][col - 1] = value;
          writes.push({ row: row, col: col, value: value });
          cells.push({ row: row, col: col });
        },
        getValues() {
          const out = [];
          for (let r = 0; r < rowCount; r += 1) {
            const line = grid[row - 1 + r] || [];
            const outLine = [];
            for (let c = 0; c < colCount; c += 1) {
              outLine.push(line[col - 1 + c] === undefined ? '' : line[col - 1 + c]);
            }
            out.push(outLine);
          }
          return out;
        },
        setValues(values) {
          values.forEach((line, r) => line.forEach((value, c) => {
            ensure(row + r, col + c);
            grid[row + r - 1][col + c - 1] = value;
          }));
        }
      };
    },
    _grid: grid,
    _writes: writes
  };
}

function installFakes(rows) {
  const contact = makeSheet(CONTACT_SHEET, CONTACT_HEADERS, rows || []);
  const requestedSheets = [];
  const openedIds = [];
  const spreadsheet = {
    getId: () => 'FAKE-SS',
    getSheetByName(name) {
      requestedSheets.push(name);
      return name === CONTACT_SHEET ? contact : null;
    }
  };
  global.__sandbox.SpreadsheetApp = {
    openById(id) {
      openedIds.push(id);
      return spreadsheet;
    }
  };
  global.__sandbox.PropertiesService = {
    getScriptProperties() {
      return { getProperty() { return null; } };
    }
  };
  global.__sandbox.CacheService = {
    getScriptCache() {
      return { get() { return null; }, put() {}, remove() {} };
    }
  };
  global.__sandbox.LockService = {
    getScriptLock() {
      return { tryLock() { return true; }, releaseLock() {} };
    }
  };
  global.__sandbox.Utilities = {
    formatDate: () => '20260101-000000',
    getUuid: () => '00000000-0000-0000-0000-000000000000'
  };
  return { contact, requestedSheets, openedIds };
}

function submit(overrides) {
  return global.submitDailyTalkOnly(Object.assign({
    studentName: '홍길동',
    phone: '010-1234-5678',
    dailyTalkTrack: 'SMALL_TALK',
    dailyTalkConsent: true
  }, overrides || {}));
}

function cell(sheet, row, col) {
  const line = sheet._grid[row - 1] || [];
  return line[col - 1] === undefined ? '' : line[col - 1];
}

describe('Daily Talk only · sanitize & validate', () => {
  test('normalizes name, phone and track', () => {
    const payload = sanitizeDailyTalkOnlyPayload({
      studentName: '  홍길동 ', phone: '+82 10 1234 5678', dailyTalkTrack: 'business', dailyTalkConsent: 'true'
    }, { consentVersion: 'v1', submittedAt: '2026-11-20T01:00:00.000Z' });
    assert.equal(payload.studentName, '홍길동');
    assert.equal(payload.phone, '010-1234-5678');
    assert.equal(payload.dailyTalkTrack, 'BUSINESS');
    assert.equal(payload.dailyTalkOptIn, true);
    assert.equal(payload.dailyTalkConsentAt, '2026-11-20T01:00:00.000Z');
    assert.equal(payload.dailyTalkConsentVersion, 'v1');
    assert.equal(payload.dailyTalkStatus, 'ACTIVE');
  });

  test('records no consent timestamp when consent is unchecked', () => {
    const payload = sanitizeDailyTalkOnlyPayload({ studentName: '홍길동', phone: '01012345678', dailyTalkTrack: 'BOTH' }, { consentVersion: 'v1', submittedAt: 'now' });
    assert.equal(payload.dailyTalkOptIn, false);
    assert.equal(payload.dailyTalkConsentAt, '');
    assert.equal(payload.dailyTalkConsentVersion, '');
    assert.equal(validateDailyTalkOnlyPayload(payload).ok, false);
  });

  test('rejects a missing name, a non-010 number, no track and no consent', () => {
    const base = { consentVersion: 'v1', submittedAt: 'now' };
    const cases = [
      [{ studentName: '', phone: '01012345678', dailyTalkTrack: 'BOTH', dailyTalkConsent: true }, 'studentName'],
      [{ studentName: '홍길동', phone: '02-123-4567', dailyTalkTrack: 'BOTH', dailyTalkConsent: true }, 'phone'],
      [{ studentName: '홍길동', phone: '01012345678', dailyTalkTrack: '', dailyTalkConsent: true }, 'dailyTalkTrack'],
      [{ studentName: '홍길동', phone: '01012345678', dailyTalkTrack: 'BOTH', dailyTalkConsent: false }, 'dailyTalkConsent']
    ];
    cases.forEach(([input, field]) => {
      const result = validateDailyTalkOnlyPayload(sanitizeDailyTalkOnlyPayload(input, base));
      assert.equal(result.ok, false, 'expected invalid for ' + field);
      assert.ok(result.errors.some((error) => error.field === field), 'expected an error on ' + field);
    });
  });

  test('builds only the Daily Talk cells and keeps a non-empty name', () => {
    const payload = sanitizeDailyTalkOnlyPayload({ studentName: '새이름', phone: '01012345678', dailyTalkTrack: 'BOTH', dailyTalkConsent: true }, { consentVersion: 'v1', submittedAt: 'now' });
    const built = buildDailyTalkOnlyContactFields(payload, { studentName: '기존이름', kakaoChannelAdded: true, lastDailyTalkSentAt: '2026-11-19' });
    assert.deepEqual(Object.keys(built.fields).sort(), [
      'dailyTalkConsentAt', 'dailyTalkConsentVersion', 'dailyTalkOptIn', 'dailyTalkStatus', 'dailyTalkTrack'
    ]);
    assert.equal(built.fields['학생명'], undefined, 'must not rename an existing student');
    assert.equal(built.storedName, '기존이름');
    assert.equal(built.nameKept, true);
  });

  test('fills the name when the contact row has none', () => {
    const payload = sanitizeDailyTalkOnlyPayload({ studentName: '홍길동', phone: '01012345678', dailyTalkTrack: 'SMALL_TALK', dailyTalkConsent: true }, { consentVersion: 'v1', submittedAt: 'now' });
    const built = buildDailyTalkOnlyContactFields(payload, { studentName: '  ' });
    assert.equal(built.fields['학생명'], '홍길동');
    assert.equal(built.storedName, '홍길동');
  });
});

describe('Daily Talk only · storage (fake sheet)', () => {
  test('a new phone adds one contact row and never opens the registration sheet', () => {
    const fake = installFakes([]);
    const result = submit();
    assert.equal(result.ok, true);
    assert.equal(result.action, 'ADDED');
    assert.equal(result.registrationRecorded, false);
    assert.equal(result.dailyTalkTrack, 'SMALL_TALK');
    assert.equal(fake.openedIds.length, 1);
    assert.deepEqual(fake.requestedSheets, [CONTACT_SHEET]);
    assert.equal(fake.requestedSheets.indexOf(REGISTRATION_SHEET), -1);
    assert.equal(fake.contact.getLastRow(), 2);
    assert.equal(cell(fake.contact, 2, 2), '홍길동');
    assert.equal(cell(fake.contact, 2, 3), '010-1234-5678');
    assert.equal(cell(fake.contact, 2, 4), '010-1234-5678');
    assert.equal(cell(fake.contact, 2, 5), true);
    assert.equal(cell(fake.contact, 2, 6), 'SMALL_TALK');
    assert.match(cell(fake.contact, 2, 7), /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(cell(fake.contact, 2, 8), '2026-11-20-dailytalk-only-v1');
    assert.equal(cell(fake.contact, 2, 10), 'ACTIVE');
    assert.equal(cell(fake.contact, 2, 14), '', 'unrelated columns stay empty');
  });

  test('a track change updates only the Daily Talk cells of the existing row', () => {
    const fake = installFakes([[
      '', '최진혁', '010-8537-0071', '010-8537-0071', true, 'BOTH',
      '2026-11-18T12:04:05.856Z', '2026-07-25-v2', true, 'ACTIVE',
      '2026-11-19T08:00:00.000Z', '2026-11-18T12:04:13.552Z', '', '수강중'
    ]]);
    const result = submit({
      studentName: '최진혁', phone: '01085370071', dailyTalkTrack: 'BUSINESS'
    });
    assert.equal(result.ok, true);
    assert.equal(result.action, 'UPDATED');
    assert.equal(result.dailyTalkTrackLabel, 'Daily Business Talk');
    assert.equal(fake.contact.getLastRow(), 2, 'must not add a row');
    assert.equal(cell(fake.contact, 2, 6), 'BUSINESS');
    assert.equal(cell(fake.contact, 2, 10), 'ACTIVE');
    assert.equal(cell(fake.contact, 2, 5), true);
    assert.equal(cell(fake.contact, 2, 8), '2026-11-20-dailytalk-only-v1');
    // Everything else on the row is untouched.
    assert.equal(cell(fake.contact, 2, 2), '최진혁');
    assert.equal(cell(fake.contact, 2, 3), '010-8537-0071');
    assert.equal(cell(fake.contact, 2, 9), true);
    assert.equal(cell(fake.contact, 2, 11), '2026-11-19T08:00:00.000Z');
    assert.equal(cell(fake.contact, 2, 12), '2026-11-18T12:04:13.552Z');
    assert.equal(cell(fake.contact, 2, 14), '수강중');
    assert.deepEqual(fake.requestedSheets, [CONTACT_SHEET]);
  });

  test('a different typed name does not rename the stored student', () => {
    const fake = installFakes([[
      '', '최진혁', '010-8537-0071', '', true, 'BOTH', '', '', '', 'ACTIVE', '', '', '', '수강중'
    ]]);
    const result = submit({ studentName: '최진혁님', phone: '010-8537-0071', dailyTalkTrack: 'SMALL_TALK' });
    assert.equal(result.ok, true);
    assert.equal(result.nameKept, true);
    assert.equal(result.studentName, '최진혁');
    assert.equal(cell(fake.contact, 2, 2), '최진혁');
  });

  test('a rejected submission touches no sheet', () => {
    const fake = installFakes([]);
    const result = submit({ dailyTalkConsent: false });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'VALIDATION_FAILED');
    assert.equal(fake.openedIds.length, 0);
    assert.equal(fake.requestedSheets.length, 0);
  });

  test('exposes the standalone consent text and version', () => {
    installFakes([]);
    const config = getDailyTalkOnlyConfig();
    assert.equal(config.ok, true);
    assert.equal(config.consentVersion, '2026-11-20-dailytalk-only-v1');
    assert.includes(config.consentText, '광고성 정보 수신에 동의');
    assert.excludes(config.consentText, '영어여권 발급 후');
    assert.equal(config.kakaoFriendUrl, 'https://pf.kakao.com/_xkFxexfX/friend');
    assert.equal(config.trackLabels.BOTH, '두 콘텐츠 모두');
  });
});
