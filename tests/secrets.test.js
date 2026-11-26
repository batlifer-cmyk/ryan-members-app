const fs = require('fs');
const path = require('path');

function walk(dir, files) {
  const out = files || [];
  fs.readdirSync(dir).forEach((name) => {
    if (name === 'node_modules' || name === '.git' || name === 'tmpqr') return;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  });
  return out;
}

const scannable = walk(ROOT).filter((file) => /\.(gs|html|js|json|md|yml|yaml)$/.test(file));

describe('secrets — no credentials in repository files', () => {
  test('no SOLAPI / Wix / OpenAI key literal is assigned in code or docs', () => {
    const pattern = /(SOLAPI_API_(?:KEY|SECRET)|WIX_API_KEY|OPENAI_API_KEY)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/;
    const offenders = [];
    scannable.forEach((file) => {
      const text = fs.readFileSync(file, 'utf8');
      if (pattern.test(text)) offenders.push(path.relative(ROOT, file));
    });
    assert.deepEqual(offenders, [], 'files with secret-like literals: ' + offenders.join(', '));
  });

  test('no JWT / bearer-looking key material is committed', () => {
    const pattern = /eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}/;
    const offenders = scannable.filter((file) => pattern.test(fs.readFileSync(file, 'utf8')));
    assert.deepEqual(offenders.map((file) => path.relative(ROOT, file)), []);
  });

  test('the operator test phone number is not committed', () => {
    const testPhone = '010' + '96541123'; // assembled so this checker never contains the number itself
    const offenders = scannable.filter((file) => fs.readFileSync(file, 'utf8').indexOf(testPhone) !== -1);
    assert.deepEqual(offenders.map((file) => path.relative(ROOT, file)), []);
  });

  test('secrets are read only through Script Properties', () => {
    const sources = ['EnglishPassportBackend.gs', 'DailyTalkWixPublisher.gs'].map((file) =>
      fs.readFileSync(path.join(ROOT, 'apps-script', file), 'utf8'));
    ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'WIX_API_KEY'].forEach((key) => {
      const usage = sources.join('\n').match(new RegExp("getProperty\\('" + key + "'\\)", 'g')) || [];
      assert.ok(usage.length >= 1, key + ' must be read with getProperty');
    });
  });

  test('.gitignore keeps clasp state, env files and credentials out of git', () => {
    const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    ['.clasp.json', '.clasprc.json', '.env', '*.key', 'credentials*.json', 'node_modules/'].forEach((entry) => {
      assert.includes(ignore, entry, '.gitignore must contain ' + entry);
    });
  });
});
