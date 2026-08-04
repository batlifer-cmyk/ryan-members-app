import wixData from 'wix-data';

const COLLECTION = 'RyanDailyTalkContent';
const PAGE_SIZE = 20;

$w.onReady(() => {
  $w('#trackFilter').options = [
    { label: 'All', value: 'ALL' },
    { label: 'Small Talk', value: 'SMALL_TALK' },
    { label: 'Business', value: 'BUSINESS' },
  ];
  $w('#trackFilter').value = 'ALL';
  $w('#trackFilter').onChange(() => loadMagazineItems());

  $w('#contentRepeater').onItemReady(($item, itemData) => {
    $item('#itemTitle').text = itemData.title || 'Ryan Daily Talk';
    $item('#itemMeta').text = [
      itemData.publishDate,
      itemData.track === 'BUSINESS' ? 'Business Talk' : 'Small Talk',
      itemData.level || 'BASIC',
    ].filter(Boolean).join(' · ');
    $item('#itemSummary').text = itemData.topicKo || itemData.topicEn || '';
    $item('#itemOpenButton').link = `/rm-magazine/${itemData.slug}`;
  });

  loadMagazineItems();
});

async function loadMagazineItems() {
  let query = wixData.query(COLLECTION)
    .eq('status', 'PUBLISHED')
    .descending('publishDate')
    .limit(PAGE_SIZE);

  const track = $w('#trackFilter').value;
  if (track && track !== 'ALL') query = query.eq('track', track);

  const result = await query.find();
  $w('#contentRepeater').data = result.items;

  if (result.items.length) {
    $w('#emptyState').collapse();
    $w('#contentRepeater').expand();
  } else {
    $w('#contentRepeater').collapse();
    $w('#emptyState').expand();
  }
}
