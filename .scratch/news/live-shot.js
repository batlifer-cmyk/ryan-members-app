/**
 * 390x844 mobile check of a live /rm-magazine/{slug} article.
 * Captures console errors, page errors, failed requests, the rendered news /
 * keyword card structure, and screenshots (top, news card, each keyword card,
 * the closing CTA).
 *
 * Usage: node .scratch/news/live-shot.js <url> <outDir> <tag>
 */
const { chromium } = require('/workspace/.scratch/pw/node_modules/playwright');

const url = process.argv[2];
const outDir = process.argv[3] || '/workspace/work/daily-talk-news-20261121';
const tag = process.argv[4] || 'news';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
    if (msg.type() === 'warning') consoleWarnings.push(msg.text().slice(0, 200));
  });
  page.on('pageerror', (error) => pageErrors.push(String(error && error.message ? error.message : error).slice(0, 300)));
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    failedRequests.push({ url: request.url().slice(0, 160), reason: failure && failure.errorText ? failure.errorText : 'failed' });
  });

  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(9000);

  const info = await page.evaluate(() => {
    const root = document.getElementById('rmdt-root');
    const rect = (el) => {
      const box = el.getBoundingClientRect();
      return { top: Math.round(box.top + window.scrollY), height: Math.round(box.height), width: Math.round(box.width) };
    };
    const cards = root ? Array.from(root.querySelectorAll('.rmdt-card')) : [];
    const news = root ? root.querySelector('.rmdt-card[data-step="news"]') : null;
    const keywords = root ? Array.from(root.querySelectorAll('.rmdt-card[data-step="keyword"]')) : [];
    return {
      title: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : '',
      article: !!root,
      rawTextHidden: (() => {
        const viewer = document.querySelector('[class*="wixui-rich-content-viewer"]');
        return viewer ? getComputedStyle(viewer).display === 'none' : null;
      })(),
      heroTitleEn: root && root.querySelector('.rmdt-title-en') ? root.querySelector('.rmdt-title-en').textContent.trim() : '',
      cards: cards.map((card) => ({ step: card.dataset.step, keyword: card.dataset.keyword || '', ...rect(card) })),
      news: news ? {
        headline: news.querySelector('.rmdt-news-headline') ? news.querySelector('.rmdt-news-headline').textContent.trim() : '',
        lines: Array.from(news.querySelectorAll('.rmdt-news-line')).map((el) => el.textContent.trim()),
        source: news.querySelector('.rmdt-news-source-text') ? news.querySelector('.rmdt-news-source-text').textContent.trim() : '',
        indexLinks: Array.from(news.querySelectorAll('.rmdt-kw-index-link')).map((a) => a.getAttribute('href') + ' :: ' + a.textContent.trim())
      } : null,
      keywords: keywords.map((card) => ({
        index: card.dataset.keyword,
        title: card.querySelector('.rmdt-kw-title') ? card.querySelector('.rmdt-kw-title').textContent.trim() : '',
        ko: card.querySelector('.rmdt-kw-ko') ? card.querySelector('.rmdt-kw-ko').textContent.trim() : '',
        usage: card.querySelector('.rmdt-kw-usage-text') ? card.querySelector('.rmdt-kw-usage-text').textContent.trim() : '',
        drills: Array.from(card.querySelectorAll('.rmdt-drill')).map((drill) => ({
          badge: drill.querySelector('.rmdt-drill-badge').textContent.trim(),
          en: drill.querySelector('.rmdt-drill-en').textContent.trim(),
          marks: Array.from(drill.querySelectorAll('.rmdt-hl')).map((m) => m.textContent),
          ko: drill.querySelector('.rmdt-drill-ko') ? drill.querySelector('.rmdt-drill-ko').textContent.trim() : '',
          pattern: drill.querySelector('.rmdt-drill-pattern') ? drill.querySelector('.rmdt-drill-pattern').textContent.trim() : ''
        }))
      })),
      cta: root && root.querySelector('.rmdt-cta') ? rect(root.querySelector('.rmdt-cta')) : null,
      ctaLinks: root ? Array.from(root.querySelectorAll('.rmdt-cta a')).map((a) => a.getAttribute('href')) : [],
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      docHeight: document.documentElement.scrollHeight
    };
  });

  console.log(JSON.stringify({
    url,
    status: response ? response.status() : null,
    consoleErrors,
    consoleWarnings,
    pageErrors,
    failedRequests,
    info
  }, null, 1));

  await page.screenshot({ path: outDir + '/' + tag + '-full.png', fullPage: true });
  const shots = [['top', 0]];
  const anchors = await page.evaluate(() => {
    const list = [['news', '.rmdt-card[data-step="news"]'], ['cta', '.rmdt-cta']];
    document.querySelectorAll('.rmdt-card[data-step="keyword"]').forEach((card) => {
      list.push(['kw' + card.dataset.keyword, '.rmdt-card[data-keyword="' + card.dataset.keyword + '"]']);
    });
    return list.map(([name, selector]) => {
      const el = document.querySelector(selector);
      if (!el) return { name, y: null };
      return { name, y: Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - 70)) };
    });
  });
  for (const anchor of anchors) {
    if (anchor.y === null) continue;
    await page.evaluate((y) => window.scrollTo(0, y), anchor.y);
    await page.waitForTimeout(700);
    await page.screenshot({ path: outDir + '/' + tag + '-' + anchor.name + '.png' });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await page.screenshot({ path: outDir + '/' + tag + '-viewport.png' });

  await browser.close();
})().catch((error) => {
  console.error('SHOT_FAILED', error && error.message ? error.message : error);
  process.exit(1);
});
