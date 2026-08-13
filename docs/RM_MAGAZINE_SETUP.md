# RM Magazine Setup

## Purpose

Move Ryan Daily Talk away from Wix Blog posts and into the existing Wix CMS collection:

```text
RyanDailyTalkContent
```

Daily Talk content should appear under:

```text
https://www.ryanmembers.com/rm-magazine
https://www.ryanmembers.com/rm-magazine/{slug}
```

The Kakao message should link to the RM Magazine item URL, not a Wix Blog post URL.

## Wix CMS

The collection already exists on the production `RYAN MEMBERS` site:

```text
Site ID: 77af5a69-40e6-48a1-a727-03aee59a6da4
Collection ID: RyanDailyTalkContent
Read permission: ANYONE
Write permission: ADMIN/CMS editor
```

Added fields:

```text
contentId     TEXT
magazineUrl   URL
contentHtml   RICH_TEXT
contentRich   RICH_CONTENT
```

Existing fields such as `title`, `slug`, `track`, `publishDate`, `status`, `topicEn`, `topicKo`, `snackEn`, `snackKo`, `chunksJson`, `modelAnswerEn`, `modelAnswerKo`, `yourTurnEn`, `yourTurnKo`, `sourceUrls`, and `kakaoText` are reused.

## Wix Editor Pages

Create these pages in the Wix Editor:

```text
/rm-magazine
/rm-magazine/{slug}
```

The exact dynamic-page mechanism can be Wix CMS dynamic pages or a normal Velo page that reads `wixLocation.path`.

### List Page Elements

Add these element IDs:

```text
#trackFilter
#contentRepeater
#itemTitle
#itemMeta
#itemSummary
#itemOpenButton
#emptyState
```

Paste `wix/rm-magazine-list-page.js` into the list page code.

### Item Page Elements

Add these element IDs:

```text
#articleSection
#articleTitle
#articleMeta
#articleBody
#backToMagazineButton
#notFoundSection
```

Paste `wix/rm-magazine-item-page.js` into the item page code.

## Apps Script Change

`apps-script/DailyTalkWixPublisher.gs` now stores generated content in Wix CMS instead of creating Wix Blog posts.
It writes both `contentHtml` and `contentRich`; use `contentRich` for a Wix Rich Content Viewer on the dynamic item page when possible.

## Current Test Status

Test sending is working in `TEST_MODE=TRUE`.

Confirmed on 2026-08-13:

```text
CONTENT_ID: TEST_OWNER_001
Kakao target: 010-9654-1123
Queue status: SENT
SOLAPI status: 정상 접수
Magazine URL: https://www.ryanmembers.com/rm-magazine/small-talk-2026-08-10-test-small-talk-sample
CMS item ID: 5771a909-b7a5-4f25-94b6-c587047e9bd3
```

The remaining issue is not Apps Script, SOLAPI, or Wix CMS data. The item URL returns HTTP 200 and the page title is the RM Magazine item title. If the page looks like the normal homepage, clean up the Wix Editor item-page template.

### Item Page Cleanup Checklist

On the `/rm-magazine/{slug}` page in the Wix Editor:

```text
1. Keep the normal site header/footer if desired.
2. Remove or hide copied homepage sections from the page body.
3. Keep one article container with ID #articleSection.
4. Keep title text with ID #articleTitle.
5. Keep meta text with ID #articleMeta.
6. Keep one rich text/html element with ID #articleBody.
7. Keep a back button with ID #backToMagazineButton.
8. Keep a collapsed not-found section with ID #notFoundSection.
9. Paste wix/rm-magazine-item-page.js into the page code.
10. Publish and retest the Kakao link.
```

If using Wix CMS dynamic pages instead of the Velo page-code approach, connect:

```text
title       -> title
meta text   -> publishDate / track / level
body viewer -> contentRich, or contentHtml if using an HTML/rich-text element
```

The function name `publishDailyTalkToWix_()` is preserved to avoid changing the outer pipeline, but it now:

```text
query RyanDailyTalkContent by slug
insert or update one CMS item
return https://www.ryanmembers.com/rm-magazine/{slug}
```

The spreadsheet queue columns remain unchanged:

```text
WIX_CONTENT_URL -> RM Magazine item URL
WIX_POST_ID     -> Wix CMS item ID
```

## Settings

The Daily Talk operations sheet has these non-secret settings:

```text
WIX_PUBLICATION_MODE=CMS_MAGAZINE
WIX_CMS_COLLECTION_ID=RyanDailyTalkContent
WIX_MAGAZINE_BASE_URL=https://www.ryanmembers.com/rm-magazine
MAGAZINE_PAGE_STATUS=LIVE_BODY_CONNECTED_NEEDS_TEMPLATE_CLEANUP
```

Keep secrets in Apps Script Script Properties only:

```text
WIX_API_KEY
SOLAPI_API_KEY
SOLAPI_API_SECRET
OPENAI_API_KEY
```

## Acceptance Check

Before sending Kakao messages to real students:

1. Create the two Wix pages. Done.
2. Deploy the updated Apps Script. Done.
3. Run one test queue item with `TEST_MODE=TRUE`. Done.
4. Confirm `WIX_CONTENT_URL` is an `/rm-magazine/...` URL. Done.
5. Confirm the URL opens the RM Magazine item page. Done.
6. Confirm Kakao test message links to the RM Magazine URL. Done.
7. Clean up the Wix item-page template before production sending.
