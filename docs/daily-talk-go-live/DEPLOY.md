# 배포 절차 (Phase 3·5·6·7) — 사람이 해야 하는 단계

이 문서는 저장소 코드를 실제 Apps Script 웹앱으로 올리고, 테스트 접수·테스트 발송을
확인한 뒤 Wix에 연결하는 순서다. 비밀값은 **어디에도 적지 않고** Script Properties에만 넣는다.

---

## 0. 사전 확인 (이미 확인된 사실)

* 등록 시트 `1P42_8yxR0Tlys8g48Cq1h4SryRHzTlljE0A-bvngwnE` 소유자: `bat.life.r@gmail.com` (연결된 계정과 동일)
* 이 계정의 Apps Script 프로젝트 22개 중 **영어여권/Daily Talk 프로젝트는 없음**
  → 새 프로젝트를 만들어야 한다(기존 바인딩 스크립트는 `RM 재등록 조기경보`용이며 별개).
* 운영 시트 `1vpPKVhDOj9Np5RL-Afu7vTHTqm4gfG3M5MCqkWmUeDE` = `Ryan Daily Talk 카카오 자동발송 운영판`
  (탭: 사용안내·설정·신청자·콘텐츠대기열·발송로그·대시보드)
* 이 작업 환경에는 `clasp`가 설치되어 있지 않고, Apps Script API도 연결 계정 권한에 없어
  **프로젝트 생성/푸시/배포는 대표 계정 OAuth 승인이 필요하다.**

---

## 1. Apps Script 프로젝트 만들기 — **독립(standalone) 프로젝트**

> ⚠️ `RM 재등록 조기경보` 시트에는 이미 **다른 계정 소유의 바인딩 스크립트**(잔디 `/등록`·카드결제
> 웹훅용 `doPost`)가 붙어 있다. 그 프로젝트에 이 코드를 넣으면 `doPost`/`onOpen`이 충돌해
> **등록 웹훅이 깨진다.** 반드시 새 독립 프로젝트를 만든다.

### 방법 A — 웹에서 새 프로젝트

1. `https://script.new` 를 연다(또는 Drive → 새로 만들기 → Apps Script).
2. 프로젝트 이름을 `English Passport + Ryan Daily Talk`로 바꾼다.
3. 아래 파일을 만든다(이름 정확히):
   * `PassportCore.gs` ← `apps-script/PassportCore.gs`
   * `EnglishPassportBackend.gs` ← `apps-script/EnglishPassportBackend.gs`
   * `DailyTalkWixPublisher.gs` ← `apps-script/DailyTalkWixPublisher.gs`
   * `Index` (HTML) ← `apps-script/Index.html`
   * `DailyTalk` (HTML) ← `apps-script/DailyTalk.html` (`?mode=dailytalk` 전용 신청 화면)
   * `QRCode` (HTML) ← `apps-script/QRCode.html`
   * 기본으로 생긴 `Code.gs`는 비우거나 지운다.
4. `프로젝트 설정` → **"appsscript.json 매니페스트 파일 표시"** 를 켜고
   `apps-script/appsscript.json` 내용으로 교체한다.

### 방법 B — clasp (로컬에서 반복 배포할 때)

```bash
npm install -g @google/clasp
clasp --version && clasp --help      # 설치된 버전의 명령 이름을 먼저 확인
clasp login                          # 브라우저 OAuth 승인 (대표 계정)

cd apps-script
# .clasp.json 은 절대 커밋하지 않는다 (.gitignore 에 포함됨)
cat > .clasp.json <<'JSON'
{"scriptId":"<SCRIPT_ID>","rootDir":"."}
JSON

clasp push
```

* 프로젝트 생성 명령의 옵션 이름은 clasp 버전마다 다르다. `clasp create --help`로 확인하고,
  없으면 방법 A로 한 번 만든 뒤 그 `SCRIPT_ID`를 `.clasp.json`에 넣는다.
  `--type sheets --parentId …`(바인딩)는 **쓰지 않는다**(위 충돌 이유).
* `appsscript.json`의 `webapp`(실행: 나 / 액세스: 모든 사용자) 설정은 배포 시 그대로 쓰인다.

---

## 2. Script Properties 등록 (비밀값)

`프로젝트 설정` → `스크립트 속성` → 아래를 추가한다.

| 키 | 값 | 비고 |
| --- | --- | --- |
| `SOLAPI_API_KEY` | SOLAPI 콘솔 API Key | 비밀 |
| `SOLAPI_API_SECRET` | SOLAPI 콘솔 API Secret | 비밀 |
| `WIX_API_KEY` | Wix API 키 | 비밀 |
| `OPENAI_API_KEY` | OpenAI 키 | 비밀 (콘텐츠 생성 단계용, 발송에는 미사용) |
| `TEST_PHONE` | 운영자 본인 휴대전화 `010-XXXX-XXXX` | 커밋 금지 |

선택(기본값이 코드에 있으므로 없어도 됨):

| 키 | 기본값 | 용도 |
| --- | --- | --- |
| `REGISTRATION_SPREADSHEET_ID` | `1P42_8yx…` | 등록 DB를 가벼운 시트로 옮길 때 이 값만 교체 |
| `REGISTRATION_SHEET` | `_DB_등록신청` | |
| `CONTACT_SHEET` | `학생연락처` | |
| `DAILY_TALK_OPERATIONS_SPREADSHEET_ID` | `1vpPKVh…` | |
| `KAKAO_CALLBACK_TOKEN` | (없음) | 카카오 친구추가 콜백을 붙일 때만 |

> 확인: 편집기에서 `getPassportRuntimeStatus()`를 실행하면 어떤 키가 들어왔는지
> **존재 여부만** true/false로 돌려준다(값은 노출되지 않는다).

---

## 3. 첫 실행 (헤더 자동 점검)

편집기에서 `setupEnglishPassport()` 실행 → 권한 승인.

* 두 시트의 1행 헤더를 읽어 컬럼을 이름으로 매핑하고,
  없는 Daily Talk 컬럼(`dailyTalkOptIn`, `dailyTalkTrack`, `dailyTalkConsentAt`,
  `dailyTalkConsentVersion`, `kakaoChannelAdded`, `dailyTalkStatus`, `lastDailyTalkSentAt`,
  `kakaoChannelClickAt`, `kakaoChannelAddedAt`)을 **오른쪽에 한 번만 추가**한다.
* 실행 로그에 매핑 결과와 활성 수신자 수가 찍힌다. 이 로그를 보관하면 Phase 1의
  "실제 헤더 구조 확인" 증빙이 된다.
* 헤더가 비어 있는데 데이터가 있으면 **에러를 내고 멈춘다**(데이터 오염 방지).

헤더만 보고 싶으면 `inspectPassportSheetHeaders()`를 실행한다(쓰기 없음).

---

## 4. 웹앱 배포 (`/exec`)

1. `배포` → `새 배포` → 유형 `웹 앱`
2. 설명: `english-passport-go-live-1`
3. **실행 사용자: 나**, **액세스: 모든 사용자**
4. 배포 후 `/exec` URL을 기록한다.
5. 점검:
   * `https://script.google.com/macros/s/<ID>/exec?action=health` → `{"ok":true,...}` JSON
   * `/exec` → 여권 표지가 보이고, 콘솔에 외부 요청 오류가 없어야 한다.
   * 모바일/데스크톱 각각 열어 완료 화면의 버튼 문구가 다른지 확인.

### 실접수 검증 (Phase 5)

1. 테스트용 이름/전화(예: 운영자 본인 번호)로 1건 제출 → 완료 화면 확인
2. `_DB_등록신청`에 행 **정확히 1개** 추가됐는지 확인(제출ID가 `EP-…`)
3. `학생연락처`에서 같은 번호 행이 **추가가 아니라 갱신**됐는지 확인
4. 같은 번호로 한 번 더 제출 → 등록 행은 1개 더 쌓이지만(신청 이력), 연락처 행은 늘지 않아야 한다
5. 테스트로 만든 등록 행은 제출ID로 찾아 삭제하고, 연락처의 Daily Talk 값은 원복한다

> `1P42` 시트는 이 작업 환경에서 `values.get`·Drive 내보내기가 모두 타임아웃될 만큼 무겁다.
> Apps Script 실행 환경에서는 더 나을 수 있지만, 3~4단계가 느리거나 실패하면
> `DB-STRUCTURE.md`의 "권장사항"대로 DB 위치를 옮기는 것이 다음 조치다.

---

## 4-1. 매일 콘텐츠 자동 생성 (OpenAI)

`apps-script/DailyTalkContentGenerator.gs`가 설정 시트 값만 보고 오늘 콘텐츠를 만든다.
발송은 하지 않고 `콘텐츠대기열`에 행만 추가한다.

### 설정 시트 키

| 키 | 현재 값 | 의미 |
| --- | --- | --- |
| `OPENAI_MODEL` | `gpt-5.5` | 생성 모델. 2026-12-11 `gpt-5` 종료로 교체 |
| `TRACKS_TO_GENERATE` | `SMALL_TALK,BUSINESS` | 매일 만들 트랙 |
| `DEFAULT_LEVEL` | `BASIC` | 학습자 난이도 |
| `AUTO_GENERATE` | `TRUE` | 파이프라인 실행 때 당일 빠진 트랙 자동 생성 |
| `AUTO_APPROVE` | `TRUE` | 생성 즉시 `APPROVED`(발송 가능). `FALSE`면 `DRAFT` |

### 동작 규칙

* 하루에 트랙별 행이 이미 있으면 **다시 만들지 않는다**(재실행해도 중복 없음). 강제 생성은 `force:true`.
* 모델이 없거나 실패하면 `gpt-5.4` → `gpt-5.5-2026-04-23` → `gpt-4.1` 순으로 넘어간다.
* 영어 필드에 한글, 한글 필드에 영어가 섞이거나 청크가 3~4개가 아니면 그 항목은 저장하지 않고 실패로 남긴다.
* `OPENAI_API_KEY`는 Script Properties에서만 읽는다. 시트·로그·응답에 값이 나가지 않는다.
* `콘텐츠대기열`에 없던 게시 컬럼 4개(`WIX_CONTENT_URL`, `WIX_POST_ID`, `WIX_PUBLISHED_AT`,
  `KAKAO_LINK_SENT_AT`)를 헤더로 한 번만 채운다(데이터는 건드리지 않는다).

### 실행

```text
generateTodayDailyTalkContent()                      // 오늘 빠진 트랙만 생성 (메뉴와 동일)
generateDailyTalkContent({ dryRun: true })           // 저장 없이 결과만 확인
generateDailyTalkContent({ tracks: 'BUSINESS', status: 'TEST' })  // 테스트 행
generateDailyTalkContentIfNeeded()                   // AUTO_GENERATE 확인 후 생성 (파이프라인이 호출)
checkDailyTalkGeneratorSetup()                       // 키·모델·설정 존재 여부만 반환
listOpenAiModels()                                   // 이 키로 쓸 수 있는 모델 id 목록
```

생성 결과는 `콘텐츠대기열` 3행 헤더 기준 19개 컬럼에 그대로 들어가고,
`CHUNKS_JSON`·`카카오본문`·`SOURCES`(`OPENAI:<모델>`)까지 채워진다.
검증용 행은 `상태=TEST`로 두면 파이프라인이 집어가지 않는다(APPROVED/PUBLISHED만 처리).
`상태=TEST`·`FAILED` 행은 그날 콘텐츠가 이미 있는 것으로 치지 않으므로 재생성도 막지 않는다.

### SMALL_TALK — 라이언멤버스 5단계 레슨 (2026-11-20 개편)

일상 대화 콘텐츠는 학원 고유 교육법 다섯 단계를 그대로 담는다. 프롬프트·스키마·검증·큐 컬럼·게시 본문이
모두 이 순서를 따른다.

| 단계 | 필드 | 내용 |
| --- | --- | --- |
| STEP 1 오늘의 단어 3개 | `words` (`CHUNKS_JSON`) | 대화에 바로 쓰는 단어·표현 3개 `{en, ko}` |
| STEP 2 그 단어로 한국어 문장 | `sentences[].ko` (`WORD_ORDER_JSON`) | 단어를 쓴 자연스러운 한국어 문장 3개 |
| STEP 3 영어 어순으로 재정렬 | `sentences[].order` (`WORD_ORDER_JSON`) | 같은 문장을 의미 조각으로 쪼개 영어 어순으로. 각 조각 `{role, text}`, role은 `누가`·`한다`·`무엇을`·`어디서`·`언제`·`어떻게` |
| STEP 4 통번역된 영어 문장 | `sentences[].en` (`WORD_ORDER_JSON`) | STEP 2·3 문장을 자연스러운 영어로. STEP 2와 같은 번호(①·②·③)로 짝을 이룬다 |
| STEP 5 AAA 3문장 | `aaa` (`STRUCTURE_JSON`, `MODEL_EN/KO`) | 위 3문장 중 하나(`pick`)를 골라 **Answer 한 문장 답 → Add 이유·디테일 → Ask 되묻기**. `MODEL_EN/KO`에는 `Answer: … / Add: … / Ask: …` |

* 스키마는 `words`·`sentences` 개수를 3으로 고정하고, `order[].role`을 6개 enum으로,
  STEP 5는 `aaa` 하나만 요구한다.
* 검증은 단계 간 연결까지 본다: 단어 3개 중 2개 이상이 영어 문장 안에 실제로 나와야 하고,
  `aaa.answer`는 고른 문장과 내용 단어를 공유해야 한다. 어순 조각은 `누가`가 `한다`보다
  앞서야 하고 조각 안에 `/`가 들어가면 안 된다.
* (2026-11-21) 카드의 질문은 영어입담비법서 PART 2의 32개 중 하나로 서버가 확정한다(`questionEn`,
  `SUBSTITUTIONS_JSON={"questionEn":…}`에 저장). ③ Ask는 상대가 먼저 한 그 질문을 그대로 되묻지 않고
  같은 주제를 다른 표현으로 묻는다(예: 질문 `"Do you like cold weather?"` → Ask `"Do you enjoy winter?"`).
  `validateDailyTalkQuestionLink_`는 소문자·문장부호·여백과 so/too 같은 군더더기를 걷어낸 뒤 Ask가 질문과
  같으면 실패로 보고 재생성한다(`dailyTalkAskRepeatsQuestion_`). `questionEn`이 없는 옛 행은 예전 방식대로 통과한다.
* (2026-11-22) 어순 조각은 **의미 덩어리 사이에서만** 자른다. 접속사 절(`when`·`because`·`if`·`while`·`after` 등)과
  전치사구·시간구는 통째로 한 칩이고, `어디서`+`언제`처럼 두 역할로 반 토막 내지 않는다.
  (`실내에 있을 때` → `어디서: 실내에` + `언제: 있을 때` ✗). 그 칩 **안의 말**도 한국어 어순이 아니라
  그 절이 영어로 말해지는 순서(주어 → 동사 → 목적어/장소/보어)로 적는다. 예: `저는 실내에 있을 때 비 오는 날을
  좋아해요.` / `I like rainy days when I'm indoors.` → `누가/저는, 한다/좋아해요, 무엇을/비 오는 날을, 언제/내가 있다 실내`.
  절의 역할은 문장에서 하는 일로 정한다: 시간 절·시간구 → `언제`, 장소·전치사구 → `어디서`,
  이유·조건·방법 절(`because`·`if`·`so that`) → `어떻게`. 조각은 `ko`의 말로만 만들고 새 내용을 더하거나 빼지 않는다.
* `WORD_ORDER_JSON`·`STRUCTURE_JSON`은 기존 컬럼을 그대로 쓴다(시트 마이그레이션 없음).
  `SUBSTITUTIONS_JSON`은 새 콘텐츠에서 비운다.
* 2026-11-20 이전에 생성된 행(옛 4단계 JSON)은 게시할 때 예전 4단계 본문으로 나간다
  (`buildDailyTalkLegacyBlocks_`) — 이미 발행된 기사와 같은 모양.

### BUSINESS — 오늘의 경제·비즈니스 뉴스 + 키워드 5개 + 패턴 드릴 10문장 (2026-11-21 개편)

업무 영어 콘텐츠는 지어낸 상황이 아니라 **그날 실제 경제·산업 뉴스**로 만든다.

1. 생성기가 공개 RSS를 읽고 후보 기사를 모은다 — `RM_DAILY_TALK_NEWS.FEEDS`:
   Google News 한국 비즈니스(`news.google.com/rss/headlines/section/topic/BUSINESS?hl=ko&gl=KR&ceid=KR:ko`),
   연합뉴스 경제(`www.yna.co.kr/rss/economy.xml`), 한국경제 경제(`www.hankyung.com/feed/economy`),
   매일경제(`www.mk.co.kr/rss/30000001/`). `UrlFetchApp`만 쓰고 키는 필요 없다.
2. 후보는 제목·요약·언론사·날짜로 정리되고(`parseNewsRssFeed`), 정치·선거·사건·스포츠·연예는
   버리고 경제 단어가 제목에 있는 것만 남겨(`selectNewsCandidates`) 점수·최신순으로 10개를
   번호를 붙여 프롬프트에 넘긴다. Google News의 설명란은 관련 기사 목록이라 요약으로 쓰지 않는다.
3. 모델은 그중 **한 가지 중립 스토리**만 골라 아래 JSON을 만든다. 출처는 모델이 쓰지 않고
   `sourceIndexes`(후보 번호)로만 지정하며, 실제 언론사·날짜·URL은 코드가 후보에서 채운다.

| 필드 | 저장 위치 | 내용 |
| --- | --- | --- |
| `news.headlineEn` | `STRUCTURE_JSON.news`, `MODEL_EN` | 오늘 뉴스의 영어 헤드라인 한 줄 |
| `news.summaryKo` 3~4줄 | `STRUCTURE_JSON.news`, `MODEL_KO` | 무슨 일이 있었고 무엇이 달라지는지, 사실만 |
| `news.sourceIndexes` → `news.sources` | `STRUCTURE_JSON.news` | 실제 언론사·날짜·URL(코드가 채움) |
| `keywords` 5개 `{en, ko, usageKo, drills[2]}` | `STRUCTURE_JSON.keywords`, `CHUNKS_JSON` | 영어 표현 + 한글 뜻 + 뉴스 속 쓰임 한 줄 + 패턴 드릴 2문장 `{en, ko, highlight}` |

* `highlight`는 그 영어 문장 안에 **그대로 들어 있는 부분 문자열**이어야 한다(검증에서 확인).
  화면은 이 부분을 형광펜으로 표시한다.
* 검증: 키워드 5개·드릴 각 2문장·키워드 중복 없음·한글/영어 필드 구분·요약 3~4줄·출처 1~3개.
* 한 번에 통과하지 못하면 **같은 프롬프트에 실패 항목을 붙여 한 번 더** 요청한다
  (`buildContentRepairPrompt`), 그래도 안 되면 행을 쓰지 않고 `failures`에 남긴다.
* `YOUR_TURN_*`은 “오늘 문장 10개를 소리 내어” 미션, `SOURCES`에는 `OPENAI:<모델>` 다음 줄에
  실제 기사 URL이 들어간다.
* 2026-11-21 이전에 만든 비즈니스 행(`type: "MESSAGE_HOUSE"`)은 그대로 읽고 검증·게시하며,
  이미 발행된 글도 예전 카드 모양으로 계속 보인다.

### Wix CMS(`RyanDailyTalkContent`) 대응 — 게시 경로

Daily Talk 글은 Wix 블로그가 아니라 CMS 컬렉션 `RyanDailyTalkContent`에 있고
`/rm-magazine/{slug}` 동적 페이지가 그 항목을 렌더한다. 그래서 게시는
`wix-data/v2` API로 한다(`apps-script/DailyTalkWixPublisher.gs`).

| `콘텐츠대기열` | `RyanDailyTalkContent` | 비고 |
| --- | --- | --- |
| `CONTENT_ID` | `contentId` | |
| `트랙` | `track` | `SMALL_TALK` / `BUSINESS` |
| `레벨` | `level` | 기본 `BASIC` |
| `TOPIC_EN` / `TOPIC_KO` | `topicEn` / `topicKo` | |
| `SNACK_EN` / `SNACK_KO` | `snackEn` / `snackKo` | |
| `CHUNKS_JSON` | `chunksJson` | `[{en,ko}]` JSON 문자열로 정규화 |
| `MODEL_EN` / `MODEL_KO` | `modelAnswerEn` / `modelAnswerKo` | |
| `YOUR_TURN_EN` / `YOUR_TURN_KO` | `yourTurnEn` / `yourTurnKo` | |
| `카카오본문` | `kakaoText` | 없으면 게시 URL로 새로 만든다 |
| (게시 시 생성) | `slug`, `title`, `publishDate`, `status`, `magazineUrl`, `contentRich`, `contentHtml`, `generatedByAi` | 아래 규칙 |

게시 규칙:

* `slug` = `{small-talk|business-talk}-{YYYY-MM-DD}-{주제 영어 단어}`. 생성 행의
  `CONTENT_ID`(`SMALL_TALK-20261119-making-lunch-plans`)에서 그대로 유도하므로
  같은 콘텐츠는 항상 같은 슬러그가 된다. 예: `small-talk-2026-11-19-making-lunch-plans`.
* `title` = `[Small Talk] 주제` / `[Business Talk] 주제`(기존 항목과 같은 형식).
* `publishDate` = `CONTENT_ID`의 날짜(없으면 `발송일`), `status` = `PUBLISHED`,
  `magazineUrl` = `https://www.ryanmembers.com/rm-magazine/{slug}`.
* `contentRich`(본문)와 `contentHtml`(같은 내용의 HTML)을 함께 채운다. 실제 페이지는
  `contentRich`를 렌더하고, 템플릿에 따라 `contentHtml`도 쓴다.
* 본문은 `TODAY'S BUSINESS NEWS` + `KEYWORD 1 · <표현>` … `KEYWORD 5 · <표현>`(비즈니스) 또는
  `STEP 1 · KEY WORDS` ~ `STEP 5 · AAA IN ACTION`(스몰톡), 옛 4단계 기사는 `STEP 1 · KEY CHUNKS` ~
  `STEP 4 · MODEL & YOUR TURN` 제목으로 나뉘고, 각 줄은 화면 스크립트가 다시 읽어 카드로 그린다
  (`wix/rm-magazine/`, 아래 4-2 참고).
* 먼저 `slug`로 조회해서 **있으면 그 항목만 PATCH**(이 게시기가 쓰는 필드만), 없으면 INSERT.
  재실행해도 같은 날 같은 트랙이 두 번 생기지 않는다. CMS 편집기나 옛 블로그 동기화가
  채운 `blogPostId`·`blogUrl`은 PATCH에서 건드리지 않는다.
* 성공하면 `콘텐츠대기열`의 `WIX_CONTENT_URL`(매거진 URL)·`WIX_POST_ID`(CMS item `_id`)·
  `WIX_PUBLISHED_AT`를 채우고, 실패하면 `상태=FAILED`와 `오류`에 상태코드와 응답을 남긴다
  (`WIX_API_KEY`는 오류 문구에서 지운다).
* `설정` 시트 값: `WIX_PUBLICATION_MODE`(`CMS_MAGAZINE`), `WIX_CMS_COLLECTION_ID`
  (`RyanDailyTalkContent`), `WIX_MAGAZINE_BASE_URL`(`https://www.ryanmembers.com/rm-magazine`).
* 되돌리기: `WIX_PUBLICATION_MODE=BLOG`이면 예전 블로그 API 경로를 쓴다. 단 그 경로는
  Blog 쓰기 권한이 있는 API 키가 필요하고, 현재 키로는 401/403이 난다.
* Wix 검색 노출은 켜기로 했으므로 `noindex` 같은 설정은 넣지 않는다.

### 4-2. `/rm-magazine/{slug}` 화면 디자인 (2026-11-20 5단계 개편)

게시되는 본문은 리치 텍스트라 카드·배지·간격을 담을 수 없다. 그래서 화면에서 다시 그린다.

* 파일: `wix/rm-magazine/rm-daily-talk.css`, `rm-daily-talk.js`(단일 원본).
* Wix 사용자 지정 코드 두 개(모두 `선택 페이지 → Ryan Daily Talk 콘텐츠 (Item)`):
  * `RM Daily Talk · 기사 스타일` — **Head** — `rm-daily-talk.css`를 `<link>`로 호출
  * `RM Daily Talk · 기사 4단계 카드` — **Body - 끝** — `rm-daily-talk.js`를 `<script defer>`로 호출
    (스니펫 이름은 그대로 두고 SHA만 올린다. 5단계도 이 스니펫이 그린다.)
* 호출 주소는 **커밋 고정 jsDelivr** URL(`.../gh/batlifer-cmyk/ryan-members-app@<SHA>/wix/rm-magazine/...`).
  스타일을 고칠 때는 커밋을 올리고 스니펫의 SHA만 바꾼다.
* 스크립트가 하는 일: ① 제목 아래 `contentId`/`slug` 줄 숨김 ② `STEP n` 단위로 카드 재구성
  ③ 한글 해석 접기(옛 기사) ④ 기사 하단 여백 132~148px + 플로팅 `#rmc-launch` 버튼 축소.
* 5단계 카드 모양:
  * STEP 1 — 단어 3개, 영어 단어 + 한국어 뜻
  * STEP 2 — ①·②·③ 번호가 붙은 한국어 문장 3개
  * STEP 3 — 같은 번호로, 문장을 `누가`·`한다`·`무엇을`·`어디서`·`언제` 역할 칩으로 쪼개 `/`로 이어 붙임
  * STEP 4 — 같은 번호의 영어 문장 3개(가장 크고 굵게)
  * STEP 5 — 고른 문장 박스 + `ANSWER`·`ADD`·`ASK` 배지가 붙은 3문장
* 비즈니스 뉴스 카드 모양(2026-11-21):
  * `TODAY'S BUSINESS NEWS` — 영어 헤드라인 → 한국어 요약 3~4줄 → `출처 · 언론사 · 날짜`
  * 카드 아래 `오늘의 키워드 5` 점프 칩(누르면 해당 키워드 카드로 이동)
  * `KEYWORD 1`~`KEYWORD 5` — 영어 표현(제목) → 한글 뜻 → `뉴스 속 쓰임` 한 줄 →
    `DRILL 1`·`DRILL 2` 블록(영어 문장 + 핵심 패턴 형광펜 + 한글 해석 + 패턴 칩)
* 2026-11-21 이전에 발행된 비즈니스 글(`STEP 5 · MESSAGE HOUSE`)은 `CONCLUSION`·`REASON`·`DETAIL`·
  `SUGGESTION` 배지 카드로 그대로 그려진다.
* 4단계 기사(2026-11-20 이전 발행분)는 예전 카드(`KEY CHUNKS`/`WORD ORDER`/`AAA`/`MODEL & YOUR TURN`)로
  그대로 그려진다. `STEP` 제목이 없는 옛 글은 아무것도 하지 않고 원문을 그대로 둔다.
* 실패 시 동작: 파싱이 안 되면 원래 리치 텍스트를 그대로 두고 아무것도 숨기지 않는다(스크립트가
  없어도 글은 그대로 읽힌다). 원문을 숨긴 뒤에만 카드가 보인다.

### 4-3. Daily Talk 전용 간단 신청·트랙 변경 (2026-11-20)

영어여권을 거치지 않고 이름·휴대폰 번호·트랙·수신동의만으로 신청하거나 트랙을 바꾸는 화면.

| 항목 | 값 |
| --- | --- |
| 공개 주소(사용자에게 보여 주는 링크) | `https://www.ryanmembers.com/?dailytalk=1` |
| 실제 화면 | `<배포>/exec?mode=dailytalk` (또는 `/exec?dailytalk=1`) |
| 파일 | `apps-script/DailyTalk.html`, `EnglishPassportBackend.gs`(`submitDailyTalkOnly`) |
| 저장 | `학생연락처`만 전화번호 기준 업서트. `_DB_등록신청`은 **절대 쓰지 않는다** |
| 기록 컬럼 | `dailyTalkOptIn`·`dailyTalkTrack`·`dailyTalkConsentAt`·`dailyTalkConsentVersion`·`dailyTalkStatus` (이름은 빈 칸일 때만 채움) |
| 보존 | 같은 번호의 다른 셀(등록상태·수업 정보·`kakaoChannelAdded`·`lastDailyTalkSentAt`)은 그대로 둔다 |
| 동의 버전 | `2026-11-20-dailytalk-only-v1` (영어여권의 `2026-07-25-v2`와 별도) |

완료 화면에는 카카오톡 채널 추가 버튼(`https://pf.kakao.com/_xkFxexfX/friend`)이 바로 나온다.
채널 버튼 클릭은 `kakaoChannelClickAt`만 기록하고 `kakaoChannelAdded`는 콜백 전까지 FALSE다.

Wix 연결은 사용자 지정 코드 `Ryan Members English Passport Preview`
(`wix/custom-code/rm-overlay.html`)가 `?passport=1`과 `?dailytalk=1`을 모두 감지해
전체화면 iframe으로 열고, 같은 X 버튼으로 닫는다.

---

## 5. Wix `?passport=1` / `?dailytalk=1` 임베드 (Phase 6)

현재 미리보기는 GitHub CDN(githack) 체인을 가리킨다. 수용 테스트가 끝난 뒤에만 바꾼다.

* Wix → 설정 → **사용자 지정 코드**의 `Ryan Members English Passport Preview`
  (모든 페이지 / Body 끝) 스니펫을 `wix/custom-code/rm-overlay.html` 내용으로 교체한다.
* 이 스니펫이 `?passport=1`이면 `/exec`, `?dailytalk=1`이면 `/exec?mode=dailytalk`를 연다.
* 사용자 지정 코드는 **저장만으로는 라이브에 적용되지 않는다** — 사이트 **게시(Publish)**까지 해야 한다.
* 교체 전 값을 반드시 적어 둔다(롤백용). 일반 페이지는 건드리지 않는다.
* Apps Script는 `XFrameOptionsMode.ALLOWALL`로 서빙하므로 Wix iframe 안에서 뜬다.

---

## 6. SOLAPI 테스트 발송 (Phase 7)

선행 조건:

* 테스트 폰이 `_xkFxexfX` 채널 **친구** 상태
* 설정 시트 `TEST_MODE = TRUE`
* Script Property `TEST_PHONE` 입력
* 실제 게시된 Wix Daily Talk **게시물** URL 확보(카테고리 페이지 URL은 거부된다)

실행:

```text
sendDailyTalkTestToOwner('https://www.ryanmembers.com/rm-magazine/<실제-게시물-슬러그>')
```

확인 항목:

| 항목 | 어디서 |
| --- | --- |
| 테스트 번호 1건만 대상 | 함수 반환값 `sentCount:1`, `targeted` |
| targeting `I` | 반환값 `targeting:"I"` |
| 접수 성공 | `providerStatusCode:2000`, `providerMessageId` 존재 |
| 실패 시 사유 보존 | `reason`/`발송로그`의 `PROVIDER_STATUS`·`오류` |
| 성공 시에만 `lastDailyTalkSentAt` 갱신 | `학생연락처` 해당 행(테스트 번호가 학생이면) |
| 로그 필드 완비 | `발송로그`: CONTENT_ID·전화번호·트랙·PROVIDER_MESSAGE_ID·발송시각·상태·모드(TEST) |

`TEST_MODE=true`인 동안 정규 파이프라인(`runDailyTalkPipeline`)은 **학생에게 발송하지 않고**
TEST_PHONE으로만 보낸다.

> 실패한 대기열 행은 자동 재시도하지 않고 `상태=FAILED`로 남는다(원인 확인 후 사람이 `APPROVED`로 되돌려 재시도).
> 같은 실행 안에서 같은 `CONTENT_ID`가 여러 번 나와도 수신자별로 한 번만 나가고,
> 이미 접수된 `CONTENT_ID+전화번호`는 다음 실행에서도 건너뛴다.

---

## 7. 롤백

1. **Wix**: `?passport=1` iframe `src`를 교체 전 URL(githack 미리보기)로 되돌린다. 즉시 원복된다.
2. **웹앱**: `배포 관리`에서 새 배포를 `보관처리`하면 기존 `/exec`가 죽는다.
   이전 정상 버전이 있으면 그 버전으로 새 배포를 만들어 URL을 다시 맞춘다.
3. **데이터**: 영어여권은 append + 연락처 upsert만 한다.
   * 잘못 들어간 신청 행: `_DB_등록신청`에서 `제출ID`로 찾아 행 삭제
   * 연락처: `dailyTalk*` 7개 컬럼과 `kakaoChannelClickAt`만 변경되므로 해당 셀만 되돌린다
     (`kakaoChannelAdded=true`는 콜백 전용이라 제출로는 절대 바뀌지 않는다)
   * Daily Talk 전용 신청이 새 번호로 만든 행: `학생연락처`에서 그 번호 행을 삭제한다
     (기존 번호는 `dailyTalk*` 5개 셀만 바뀌었으므로 그 셀만 되돌린다)
4. **발송**: `TEST_MODE=true`로 두면 실학생 발송이 즉시 멈춘다. 트리거도 함께 중지.

---

## 8. 실서비스 전환 (대표 승인 후)

```text
설정 시트 B열
  TEST_MODE = FALSE          ← 유일한 스위치
유지
  BMS_TARGETING = I
  DISABLE_SMS_FALLBACK = TRUE
```

전환 전 확인:

- [ ] 수용 테스트(4번) 통과, 테스트 행 정리 완료
- [ ] 테스트 카카오 발송 1건 성공(6번)
- [ ] Wix 임베드 교체 완료(5번)
- [ ] 활성 수신자 수와 명단을 사람이 한 번 대조(`getDailyTalkAudienceReport()`)
- [ ] 매일 발송 트리거 등록(평일 08시 등) — 메뉴가 없으면 편집기에서 트리거를 직접 추가한다
      (`runDailyTalkPipeline`, 시간 기반, 평일 08:00). `onOpen` 메뉴는 시트에 바인딩된
      프로젝트에서만 보이므로, 독립 프로젝트에서는 사용하지 않는다.
