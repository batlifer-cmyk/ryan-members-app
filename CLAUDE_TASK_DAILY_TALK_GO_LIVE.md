# Claude Code Task: English Passport + Ryan Daily Talk Go-Live

## Mission

Take the existing Ryan Members English Passport and Ryan Daily Talk implementation from preview/prototype to a production-ready, test-validated deployment.

Work end-to-end. Do not ask the owner to make routine code changes. Only pause for the minimum human-only actions: Google OAuth/browser approval, adding the Kakao channel as a friend on the test phone, and entering secret credentials locally.

## Repository

- Repository: `batlifer-cmyk/ryan-members-app`
- Work on a new branch: `claude/daily-talk-go-live`
- Open a Draft PR when implementation and automated tests are ready.
- Do not merge to `main` automatically.

## Production constants

```text
REGISTRATION_SPREADSHEET_ID=1P42_8yxR0Tlys8g48Cq1h4SryRHzTlljE0A-bvngwnE
REGISTRATION_SHEET=_DB_등록신청
CONTACT_SHEET=학생연락처
DAILY_TALK_OPERATIONS_SPREADSHEET_ID=1vpPKVhDOj9Np5RL-Afu7vTHTqm4gfG3M5MCqkWmUeDE
SOLAPI_PF_ID=KA01PF260722185348723BIBV44r241y
KAKAO_CHANNEL_PUBLIC_ID=_xkFxexfX
KAKAO_FRIEND_URL=https://pf.kakao.com/_xkFxexfX/friend
WIX_SITE_ID=77af5a69-40e6-48a1-a727-03aee59a6da4
WIX_SITE_URL=https://www.ryanmembers.com
WIX_BLOG_CATEGORY_ID=736b3232-2c06-4ff8-bf2d-970a5d838cba
BMS_TARGETING=I
DISABLE_SMS_FALLBACK=true
TEST_MODE=true
CONSENT_VERSION=2026-07-25-v2
TIMEZONE=Asia/Seoul
```

`BMS_TARGETING` must remain `I` for the initial rollout. Do not change it to `M` or `N`.

## Existing files to audit first

Inspect at minimum:

- `apps-script/EnglishPassportBackend.gs`
- `apps-script/DailyTalkWixPublisher.gs`
- `passport-v5-dailytalk-choice.html`
- `passport-v6-direct-friend-link.html`
- `passport-v7-channel-cta.html`
- any existing `appsscript.json`, `.clasp.json`, package files, tests, and deployment notes

Do not assume the current nested iframe/loader chain is production quality. Replace it with the simplest maintainable architecture.

## Non-negotiable product requirements

### English Passport

1. No separate Google Form or Wix application form.
2. Reuse the phone number collected in the English Passport.
3. Registration fields include student name, normalized phone, registration type, lesson count including custom count, course, teacher, learning goal, privacy consent, and Daily Talk fields.
4. The Daily Talk consent checkbox is optional and unchecked by default.
5. Exact consent text:

> 영어여권 발급 후 라이언멤버스의 평일 영어 학습 콘텐츠를 카카오톡으로 받겠습니다. 광고성 정보 수신에 동의하며, 카카오톡 채널 차단을 통해 언제든 중단할 수 있습니다.

6. When opted in, the student can make the final selection:
   - `SMALL_TALK` — Daily Small Talk
   - `BUSINESS` — Daily Business Talk
   - `BOTH` — both
7. Course-based classification is recommendation/default only. The student's final choice overrides it.
8. Completion copy:

```text
영어로 여는 새로운 세계.

당신은 용감한 여행자입니다.
자, 이제 출발을 허가합니다.

Welcome to a Bigger World.
```

9. Completion screen contains a strong Kakao channel-add CTA.
   - Mobile: direct friend link.
   - Desktop: large QR and explicit steps; do not send the user to a profile page with a tiny CTA as the primary flow.
10. Never set `kakaoChannelAdded=true` merely because a link or QR button was clicked. Only set it when an official Kakao callback confirms success. Otherwise preserve `false` and record a separate click event only if needed.

### Storage and contact upsert

Add/preserve these fields in both `_DB_등록신청` and `학생연락처`:

```text
dailyTalkOptIn
dailyTalkTrack
dailyTalkConsentAt
dailyTalkConsentVersion
kakaoChannelAdded
dailyTalkStatus
lastDailyTalkSentAt
```

Rules:

- Normalize Korean mobile numbers to `010-XXXX-XXXX` internally.
- Existing phone number: update the existing student row.
- New phone number: add a new student row.
- No separate Daily Talk applicant database.
- Active audience is extracted from English Passport/contact data using:
  - `dailyTalkOptIn = true`
  - `dailyTalkStatus = ACTIVE`
  - valid normalized phone

### Daily Talk publication and send flow

```text
Generate content
→ publish to Ryan Daily Talk category in Wix Blog
→ store the final Wix post URL
→ send the Wix URL through SOLAPI Kakao Brand Message
→ update lastDailyTalkSentAt and logs
```

- Keep SMS fallback disabled.
- Send only to Kakao channel friends during the initial rollout (`targeting=I`).
- Track `SMALL_TALK`, `BUSINESS`, and `BOTH` correctly.
- A `BOTH` recipient receives each relevant track, without duplicate sends of the same content ID.
- Failed sends must not be marked successful.
- Make all send operations idempotent by content ID + recipient phone.

## Architecture requirement

Production must not depend on chained GitHub CDN loaders and nested cross-frame DOM mutation.

Preferred target:

1. A single Apps Script web app serves the English Passport HTML through `doGet()`.
2. The browser calls `google.script.run` for submission.
3. The Apps Script project owns the Sheets upsert logic and Daily Talk pipeline.
4. Wix `?passport=1` embeds the deployed Apps Script `/exec` URL directly.
5. Keep the current preview URL active until production acceptance tests pass.

If there is a technically superior equivalent, document the reason before using it.

## Secrets and security

Never commit, print in logs, paste into Markdown, or store in Sheets:

```text
SOLAPI_API_KEY
SOLAPI_API_SECRET
WIX_API_KEY
OPENAI_API_KEY
```

Use Apps Script Script Properties. Add `.clasp.json`, local environment files, and credential files to `.gitignore` as appropriate.

`SOLAPI_PF_ID` is not a secret and may remain in settings/code.

## Execution sequence

### Phase 1 — Audit and tests

- Validate current Sheets columns and exact indexes by header name, not hard-coded column numbers where practical.
- Add unit-testable pure functions for phone normalization, track recommendation, final track resolution, recipient filtering, deduplication, and payload validation.
- Add local tests using mocks/fixtures. Do not send messages or write production Sheets during tests.

### Phase 2 — Consolidate the Passport frontend

- Build one production `Index.html` under the Apps Script source.
- Preserve the approved design and copy.
- Implement custom lesson count and full course list.
- Implement Daily Talk consent and final track choice.
- Implement mobile direct friend CTA and desktop QR modal.
- Remove preview-only mock submission in the production build.

### Phase 3 — Apps Script project setup

Use the current installed `@google/clasp` version and inspect `clasp --help` before choosing command names.

- If an existing Apps Script project is already bound to the registration Sheet, clone it after obtaining its Script ID.
- Otherwise create a new Sheet-bound Apps Script project using the registration spreadsheet as parent.
- Add an explicit `appsscript.json` with `Asia/Seoul` timezone and only required scopes.
- Push code with clasp.
- Do not put secrets in repository files.

Pause once for the owner to complete Google login/OAuth approval and enter Script Properties.

### Phase 4 — Script Properties

Require these properties before live calls:

```text
SOLAPI_API_KEY
SOLAPI_API_SECRET
WIX_API_KEY
OPENAI_API_KEY
```

Confirm the following non-secret settings are loaded from the settings sheet or constants:

```text
SOLAPI_PF_ID=KA01PF260722185348723BIBV44r241y
BMS_TARGETING=I
KAKAO_CHANNEL_URL=https://pf.kakao.com/_xkFxexfX/friend
TEST_MODE=true
DISABLE_SMS_FALLBACK=true
```

Ask the owner once for `TEST_PHONE`. Do not commit it unless the owner explicitly requests that.

### Phase 5 — Deploy the web app

- Execute as the owner/deployer.
- Access must allow the student-facing public page.
- Create a versioned deployment and capture the `/exec` URL.
- Verify `doGet()` returns the real Passport UI.
- Verify a test submission writes exactly one registration row and performs one contact upsert.
- Verify repeat submission with the same phone updates rather than duplicates the contact.

### Phase 6 — Wix integration

Replace the current preview iframe source only after the Apps Script web app passes the tests.

- The Wix custom embed for `?passport=1` must point directly to the Apps Script `/exec` URL.
- Keep normal Wix pages unaffected.
- If Wix API credentials are unavailable, produce the exact final embed patch and stop at one clearly stated owner action.

### Phase 7 — SOLAPI controlled test

Preconditions:

- The owner has added `_xkFxexfX` as a Kakao channel friend on the test phone.
- `TEST_MODE=true`.
- `TEST_PHONE` is set.
- SMS fallback is disabled.

Run one controlled Brand Message test using PFID:

```text
KA01PF260722185348723BIBV44r241y
```

The message must contain a valid Wix Daily Talk post URL.

Validate:

- only the test phone was targeted
- targeting is `I`
- send result is successful
- failure response is preserved if unsuccessful
- `lastDailyTalkSentAt` updates only after confirmed success
- send log contains content ID, phone, track, provider result ID, timestamp, and status

### Phase 8 — Acceptance report

Before requesting production enablement, provide:

1. Changed files
2. Apps Script project/deployment identifiers excluding secrets
3. Wix embed status
4. Test submission evidence
5. Test Kakao send evidence
6. Remaining manual action, if any
7. Rollback procedure
8. Exact switch required to move from test to production

Do not set `TEST_MODE=false` and do not message real students without explicit owner approval.

## Acceptance criteria

- English Passport works on desktop and mobile.
- A student can register without opting into Daily Talk.
- Opted-in student can choose Small Talk, Business, or Both.
- The selected track is stored unchanged.
- Registration and contact records are written/upserted correctly.
- The correct PFID is used.
- The Kakao channel friend CTA is clear on PC and direct on mobile.
- One owner-only test message successfully delivers through the new channel.
- No secret exists in Git history, Sheets, browser source, logs, or PR text.
- Production sends remain disabled pending owner approval.

## Claude Code startup instruction

When invoked, begin by reading this file, auditing the repository, creating the branch, and producing a concise execution plan. Then implement without repeatedly asking for confirmation. Pause only at unavoidable authentication/secret-entry checkpoints.
