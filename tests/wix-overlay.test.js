/**
 * Wix custom code "Ryan Members English Passport Preview" (wix/custom-code/rm-overlay.html).
 *
 * This snippet is what turns the magazine CTA link (?dailytalk=1) into the
 * half-page form. It is copied into the Wix dashboard by hand, so the file in
 * the repository and the saved snippet can drift; these checks pin the parts
 * that would silently break the live page.
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(ROOT, 'wix', 'custom-code', 'rm-overlay.html'), 'utf8');
const EXEC = 'https://script.google.com/macros/s/AKfycbxnZNL83GP5vO0t1bbzOKZrMOoI5MJjukQ_lE2EwGHfTYsSbLaLjOgXYZEqvbaSk4E-pA/exec';

describe('Wix overlay custom code', () => {
  test('still opens the English Passport for ?passport=1', () => {
    assert.includes(html, "q.get('passport')==='1'");
    assert.includes(html, "f.src=daily?EXEC+'?mode=dailytalk':EXEC");
  });

  test('opens the standalone Daily Talk view for ?dailytalk=1', () => {
    assert.includes(html, "q.get('dailytalk')==='1'");
    assert.includes(html, "?mode=dailytalk");
    assert.includes(html, "'Ryan Daily Talk 신청'");
  });

  test('uses the live /exec deployment and nothing else', () => {
    assert.includes(html, EXEC);
    const execUrls = [...new Set(html.match(/https:\/\/script\.google\.com[^'"\s]+/g) || [])];
    assert.deepEqual(execUrls, [EXEC]);
    assert.excludes(html, 'cdn.jsdelivr');
    assert.excludes(html, 'githubusercontent');
  });

  test('keeps the same close button for both modes', () => {
    assert.includes(html, "b.id='rm-passport-close'");
    assert.includes(html, "b.addEventListener('click',close)");
    assert.includes(html, "document.documentElement.style.overflow=''");
  });

  test('leaves every other page untouched', () => {
    assert.includes(html, 'if(!daily&&!passport)return;');
    assert.includes(html, "if(document.getElementById('rm-passport-frame'))return;");
  });
});
