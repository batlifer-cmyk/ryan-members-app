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

---

## 5. Wix `?passport=1` 임베드 교체 (Phase 6)

현재 미리보기는 GitHub CDN(githack) 체인을 가리킨다. 수용 테스트가 끝난 뒤에만 바꾼다.

* Wix 편집기 → 해당 페이지의 `HTML 임베드`(또는 `커스텀 코드`) → `?passport=1` 분기에서
  iframe `src`를 위에서 받은 **`/exec` URL**로 교체.
* 교체 전 값을 반드시 적어 둔다(롤백용).
* 일반 페이지는 건드리지 않는다.
* Apps Script는 `XFrameOptionsMode.ALLOWALL`로 서빙하므로 Wix iframe 안에서 뜬다.

Wix API 키가 없어도 이 단계는 위 편집기 조작만으로 끝난다(코드 수정 불필요).

---

## 6. SOLAPI 테스트 발송 (Phase 7)

선행 조건:

* 테스트 폰이 `_xkFxexfX` 채널 **친구** 상태
* 설정 시트 `TEST_MODE = TRUE`
* Script Property `TEST_PHONE` 입력
* 실제 게시된 Wix Daily Talk **게시물** URL 확보(카테고리 페이지 URL은 거부된다)

실행:

```text
sendDailyTalkTestToOwner('https://www.ryanmembers.com/post/<실제-게시물-슬러그>')
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
