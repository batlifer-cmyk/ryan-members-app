import wixData from 'wix-data';
import wixLocation from 'wix-location';

const COLLECTION = 'RyanDailyTalkContent';

$w.onReady(async () => {
  const slug = wixLocation.path[wixLocation.path.length - 1];
  if (!slug) {
    showNotFound();
    return;
  }

  const result = await wixData.query(COLLECTION)
    .eq('slug', slug)
    .eq('status', 'PUBLISHED')
    .limit(1)
    .find();

  const item = result.items[0];
  if (!item) {
    showNotFound();
    return;
  }

  $w('#articleTitle').text = item.title || 'Ryan Daily Talk';
  $w('#articleMeta').text = [
    item.publishDate,
    item.track === 'BUSINESS' ? 'Business Talk' : 'Small Talk',
    item.level || 'BASIC',
  ].filter(Boolean).join(' · ');
  $w('#articleBody').html = item.contentHtml || fallbackArticleHtml(item);
  $w('#backToMagazineButton').link = '/rm-magazine';
  $w('#articleSection').expand();
  $w('#notFoundSection').collapse();
});

function showNotFound() {
  $w('#articleSection').collapse();
  $w('#notFoundSection').expand();
}

function fallbackArticleHtml(item) {
  return [
    item.topicEn ? `<h2>${escapeHtml(item.topicEn)}</h2>` : '',
    item.topicKo ? `<p>${escapeHtml(item.topicKo)}</p>` : '',
    item.snackEn ? `<h3>Today&rsquo;s Language Snack</h3><p>${escapeHtml(item.snackEn)}</p>` : '',
    item.snackKo ? `<p>${escapeHtml(item.snackKo)}</p>` : '',
    item.modelAnswerEn ? `<h3>Model Answer</h3><p>${escapeHtml(item.modelAnswerEn)}</p>` : '',
    item.modelAnswerKo ? `<p>${escapeHtml(item.modelAnswerKo)}</p>` : '',
    item.yourTurnEn ? `<h3>Your Turn</h3><p>${escapeHtml(item.yourTurnEn)}</p>` : '',
    item.yourTurnKo ? `<p>${escapeHtml(item.yourTurnKo)}</p>` : '',
  ].filter(Boolean).join('\n');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
