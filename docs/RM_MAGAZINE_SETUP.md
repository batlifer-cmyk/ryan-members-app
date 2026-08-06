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
MAGAZINE_PAGE_STATUS=NEEDS_WIX_EDITOR_PAGE
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

1. Create the two Wix pages.
2. Deploy the updated Apps Script.
3. Run one test queue item with `TEST_MODE=TRUE`.
4. Confirm `WIX_CONTENT_URL` is an `/rm-magazine/...` URL.
5. Confirm the URL opens the RM Magazine item page.
6. Confirm Kakao test message links to the RM Magazine URL.
7. Only then consider production sending.
