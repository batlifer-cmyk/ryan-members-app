/**
 * /rm-magazine/{slug} closing CTA (Ryan Daily Talk 무료 신청 · 트랙 변경).
 *
 * The CTA is injected by wix/rm-magazine/rm-daily-talk.js and styled by
 * wix/rm-magazine/rm-daily-talk.css, both served from jsDelivr by Wix custom
 * code. These tests pin the two things that break silently on a live page:
 * the links it points at, and the bottom padding that keeps the floating
 * price-calculator button off the card.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(ROOT, 'wix', 'rm-magazine');
const js = fs.readFileSync(path.join(DIR, 'rm-daily-talk.js'), 'utf8');
const css = fs.readFileSync(path.join(DIR, 'rm-daily-talk.css'), 'utf8');

describe('rm-daily-talk closing CTA', () => {
  test('points the sign-up button at the standalone Daily Talk page', () => {
    assert.includes(js, "signup: 'https://www.ryanmembers.com/?dailytalk=1'");
    assert.includes(js, "button.setAttribute('href', CTA_LINKS.signup)");
  });

  test('points the channel link at the live Kakao friend URL', () => {
    assert.includes(js, "kakao: 'https://pf.kakao.com/_xkFxexfX/friend'");
    assert.includes(js, "kakaoLink.setAttribute('rel', 'noopener noreferrer')");
  });

  test('offers sign-up, track change and channel add as three separate links', () => {
    // sign-up button, "트랙 변경" link, "카카오톡 채널 추가" link
    assert.includes(js, "make('a', 'rmdt-cta-btn'");
    assert.includes(js, "'트랙 변경'");
    assert.includes(js, "'카카오톡 채널 추가'");
  });

  test('sends the track-change link to the same standalone page', () => {
    assert.includes(js, "trackLink.setAttribute('href', CTA_LINKS.signup)");
    assert.excludes(js, '?passport=1');
  });

  test('sits inside the rendered article, after the last step card', () => {
    const appendAt = js.indexOf('article.appendChild(renderCta())');
    const renderedGuardAt = js.indexOf('if (!rendered) return null;');
    assert.ok(appendAt > renderedGuardAt, 'CTA must be appended after the step cards');
    assert.ok(js.indexOf("article.id = 'rmdt-root'") < appendAt, 'CTA must live inside #rmdt-root');
  });

  test('never claims a confirmed Kakao friend add or subscription', () => {
    assert.excludes(js, 'kakaoChannelAdded');
    assert.excludes(js, '수신 신청이 완료');
  });

  test('keeps enough bottom padding for the floating calculator button', () => {
    assert.match(css, /#rmdt-root\s*\{[^}]*padding:\s*4px 0 132px/);
    assert.match(css, /@media \(max-width: 749px\)[\s\S]*?#rmdt-root\s*\{\s*padding-bottom:\s*148px/);
  });

  test('styles every class the CTA renderer creates', () => {
    const classes = new Set();
    const regex = /make\('(?:a|p|span|aside)', '([^']+)'/g;
    let match = regex.exec(js);
    while (match) {
      match[1].split(/\s+/).filter(Boolean).forEach((name) => {
        if (name.indexOf('rmdt-cta') === 0) classes.add(name);
      });
      match = regex.exec(js);
    }
    // the two bare <a> links in the sub line are styled by their parent rule
    assert.ok(classes.size >= 6, 'expected the CTA class list, got ' + [...classes].join(', '));
    classes.forEach((name) => {
      assert.includes(css, '#rmdt-root .' + name, 'missing CSS rule for .' + name);
    });
    assert.includes(css, '#rmdt-root .rmdt-cta-sub a');
  });

  test('keeps the primary button white-on-green against Wix link styles', () => {
    assert.match(css, /#rmdt-root \.rmdt-cta-btn \{[^}]*color:\s*#ffffff\s*!important/);
    assert.match(css, /#rmdt-root \.rmdt-cta-btn \{[^}]*text-decoration:\s*none\s*!important/);
  });
});
