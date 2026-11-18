# Phase 1 — 시트 DB 구조 조사 결과

조사일: 2026-11-18 · 담당: 아르뢀(백그라운드 작업)

---

## 1. 확인한 사실

### `1P42_8yxR0Tlys8g48Cq1h4SryRHzTlljE0A-bvngwnE` — `RM 재등록 조기경보`

* 소유자: `bat.life.r@gmail.com` (연결된 계정), 탭 24개, 로케일 `ko_KR`, 시간대 `Asia/Seoul`
* `_DB_등록신청`: **23열**(A~W), 1,000행 그리드, 1행 고정, 기본 필터 A~P
* `학생연락처`: 26열, 999행 그리드, 1행 고정
* 그 밖에 `_DB_졸업로그`, `_DB_등록로그`, `_DB_회차조정_V2`, `_DB_회차원장_V2`,
  `연락처원본_IMPORT`(10,482행), `시트1`(16,883행) + 백업 3종(각 16,554~16,883행),
  `전체연락처_마케팅리드`(5,608행) 등 **대용량 탭 10여 개**가 같은 파일에 있다.

### `1lteVAxrMeI2GVJ95CpDuWUHw7cr5paoyJS8xwLWB-b8` — `RM 등록 원장`

* 탭은 2개뿐: `_DB_등록로그`(1,080행), `_DB_등록실패`(1,000행)
* 파일 크기 25KB 수준의 **경량 시트**. 결제/등록 로그의 정본이며 회차조회 엔진이 이미 이 시트를 쓴다.
* **영어여권 신청(`_DB_등록신청`)이나 연락처(`학생연락처`)는 이 시트에 없다.**

### `1vpPKVhDOj9Np5RL-Afu7vTHTqm4gfG3M5MCqkWmUeDE` — `Ryan Daily Talk 카카오 자동발송 운영판`

| 탭 | 구조 |
| --- | --- |
| `설정` | A열 키 / B열 값 / C열 설명 / D열 권장값 (4행부터). 실값 확인: `SOLAPI_PF_ID`, `BMS_TARGETING=I`, `KAKAO_CHANNEL_URL`, `TEST_MODE=TRUE`, `TEST_PHONE`(입력돼 있음), `DISABLE_SMS_FALLBACK=TRUE`, `MAX_RECIPIENTS_PER_RUN=300`, `CONSENT_VERSION=2026-07-25-v2`, `SOURCE_REGISTRATION_SHEET=_DB_등록신청`, `SOURCE_CONTACT_SHEET=학생연락처` |
| `콘텐츠대기열` | **3행이 헤더**. CONTENT_ID, 발송일, 트랙, 레벨, 상태, TOPIC_EN/KO, SNACK_EN/KO, CHUNKS_JSON, MODEL_EN/KO, YOUR_TURN_EN/KO, SOURCES, 카카오본문, 생성시각, 발송시각, … |
| `발송로그` | 1행 헤더. 발송 단위 기록(수신자·콘텐츠·결과) |
| `신청자` | "ACTIVE 발송대상 자동 추출 뷰 — 직접 입력 금지" 라고 명시된 **파생 뷰**. 별도 신청 DB가 아님 → 요구사항과 일치 |

### 읽기 성능 (중요)

| 작업 | 결과 |
| --- | --- |
| `sheets metadata` (1P42) | 정상, 즉시 |
| `sheets get 1P42 '_DB_등록신청!A1:W1'` | **타임아웃** (여러 번 재시도 모두 동일) |
| `sheets get 1P42 '학생연락처!A1:Z3'` | **타임아웃** |
| `sheets get 1P42 '_DB_등록로그!A1:P3'` (1,079행짜리 작은 탭) | **타임아웃** |
| `drive export 1P42 (csv)` | **타임아웃** |
| `sheets get 1vpPKVh…` (운영 시트) | 정상 |

→ 1P42는 **탭 크기와 무관하게** 값 조회 자체가 응답하지 않는다. 파일 전체(백업 탭 포함)가
무거워 어떤 조회든 재계산/전송 비용이 큰 상태로 보인다. 메모리에 기록된
"1P42 사본 시트는 어떤 범위든 30초+ 타임아웃"(2026-11-16, v48 작업)과 같은 현상이다.

**따라서 이번 조사에서는 `_DB_등록신청`·`학생연락처`의 실제 헤더 문자열을 끝까지 읽지 못했다.**
(읽으려고 5회 이상 재시도했고, Drive 내보내기까지 시도했다.)

---

## 2. 코드가 가정한 구조 (기존 `EnglishPassportBackend.gs` 주석 기준)

`_DB_등록신청` (A~W = 23열)

| 열 | 필드 |
| --- | --- |
| A | 제출ID |
| B | 제출일시 |
| C | 학생명 |
| D | 전화번호 |
| E | 등록구분 |
| F | 신청회차 |
| G | 수업유형(과목) |
| H | 담당강사 |
| I | 학습목표 |
| J | 개인정보동의 |
| K | 제출경로 |
| L | 학생매칭상태 |
| M | 결제매칭상태 |
| N | 처리상태 |
| O | 등록로그ID |
| P | 원본요청JSON |
| Q | dailyTalkOptIn |
| R | dailyTalkTrack |
| S | dailyTalkConsentAt |
| T | dailyTalkConsentVersion |
| U | kakaoChannelAdded |
| V | dailyTalkStatus |
| W | lastDailyTalkSentAt |

* 그리드 열 수 23 = A~W 23개와 **정확히 일치**한다. 기존 코드가 이 시트를 보며 작성된 것과
  일치하는 강한 정황이지만, 헤더 문자열 자체는 확인하지 못했다.

`학생연락처` (기존 코드 주석)

| 열 | 필드 |
| --- | --- |
| A | 학생명 |
| C | 수동입력(전화) |
| D | 최종전화번호 |
| H~N | dailyTalkOptIn, track, consentAt, consentVersion, kakaoChannelAdded, status, lastDailyTalkSentAt |

* 26열 중 B·E·F·G·O~Z의 의미는 코드에 없다.

---

## 3. 그래서 코드를 어떻게 바꿨나

하드코딩된 열 번호를 **헤더 이름 기반 매핑**으로 교체했다 (`resolveColumnMap`).

* 후보 이름을 **우선순위 순**으로 찾는다(예: `최종전화번호` > `전화번호`).
  열 순서가 바뀌어도, 중간에 열이 끼어도 동작한다.
* 없는 Daily Talk 컬럼은 **맨 오른쪽에 1회만** 추가한다(`ensureHeaderColumns_`).
  이미 값이 들어 있는데 1행 헤더가 비어 있으면 **에러를 내고 멈춘다**(데이터 오염 방지).
* 매핑 결과는 `setupEnglishPassport()` / `inspectPassportSheetHeaders()` 실행 로그로 확인한다.
  → 배포 직후 이 로그가 실제 헤더 구조의 확정 증빙이 된다.

---

## 4. 권장사항 (DB 위치)

### 결론: 지금은 1P42 유지 + "탈출 스위치" 준비, 성능 확인 후 경량 시트로 이전

1. **기본값은 그대로 1P42.** `_DB_등록신청`은 `RM 재등록 조기경보` 바인딩 스크립트가 함께 쓰는
   구조라, 조사 없이 옮기면 재등록 알림·웹훅 흐름이 끊길 수 있다.
2. **대신 위치를 한 줄로 바꿀 수 있게 해 두었다.** Script Property
   `REGISTRATION_SPREADSHEET_ID`(그리고 `REGISTRATION_SHEET`, `CONTACT_SHEET`)만 바꾸면
   코드 수정 없이 새 시트로 옮겨진다.
3. **이전 후보 1순위: `RM 등록 원장`(1lteVA…).** 파일 25KB·탭 2개로 이미 회차조회 엔진의
   정본이며, 이 환경에서도 읽기가 정상이다. 여기에 `_DB_등록신청`·`학생연락처`를 새로 만들어
   대표가 한 번 값을 확인한 뒤 `REGISTRATION_SPREADSHEET_ID`를 바꾸는 방식이 가장 안전하다.
4. **이전 후보 2순위: 1P42 정리.** `시트1_백업_*` 3종과 `연락처원본_IMPORT`, `시트1`만
   다른 파일로 옮겨도 조회 응답이 살아날 가능성이 크다. 다만 백업 탭은 다른 자동화가
   참조할 수 있어 먼저 참조 여부를 확인해야 한다.
5. **발송 대상 읽기 비용은 따로 줄였다.** `refreshDailyTalkAudienceMirror()`가 활성 수신자
   명단을 운영 시트의 `발송대상` 탭(5열)으로 복사하고, `getAudienceForSend_()`는 24시간 이내
   미러가 있으면 그 작은 탭만 읽는다. 매일 발송이 무거운 원본을 매번 스캔하지 않게 하기 위함이다.
6. **측정 과제(사람 확인):** 배포 후 아래 두 가지를 재보고, 한쪽이라도 10초를 넘으면 이전을 실행한다.
   * `setupEnglishPassport()` 실행 시간
   * 실제 여권 1건 제출 → 완료 화면까지 걸린 시간

---

## 5. 남은 확인 항목

* `_DB_등록신청`·`학생연락처`의 **실제 헤더 문자열**(1행) — 배포 환경에서
  `inspectPassportSheetHeaders()` 로그로 확정
* `학생연락처` B·E·F·G열의 의미(다른 자동화가 쓰는지)
* `신청자` 파생 뷰가 어떤 수식으로 만들어지는지(발송 대상 미러와 중복되지 않도록)
* `_DB_등록신청`에 이미 들어 있는 기존 신청 행의 `kakaoChannelAdded` 값 분포
  (지금까지 `true`로 잘못 채워진 행이 있는지)
