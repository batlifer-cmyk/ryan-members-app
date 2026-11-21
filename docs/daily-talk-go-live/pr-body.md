# English Passport + Ryan Daily Talk — go-live 구현 (Draft)

`CLAUDE_TASK_DAILY_TALK_GO_LIVE.md`의 **Phase 1~3 + 배포 준비**까지 반영했습니다.
실서비스 전환(`TEST_MODE=false`)과 실제 학생 발송은 하지 않았습니다.

## 핵심 변경

* **단일 웹앱**: `apps-script/Index.html` 하나를 `doGet()`이 직접 서빙합니다.
  v3~v7 GitHub CDN iframe 체인·교차 프레임 DOM 주입·미리보기 mock 제출을 제거했습니다.
  제출은 `google.script.run.submitPassport`로 나갑니다.
* **순수 함수 계층** `apps-script/PassportCore.gs`: 전화번호 정규화, 트랙 추천/최종 선택,
  커스텀 회차, 페이로드 검증, ACTIVE 수신자 필터, 중복 제거, `contentId+phone` 멱등,
  SOLAPI 응답 해석, 헤더→컬럼 매핑. Google API를 호출하지 않아 픽스처만으로 테스트됩니다.
* **백엔드**: 헤더 **이름** 기반 컬럼 매핑(열 순서 변경·중간 삽입에 견딤), 없는 Daily Talk 컬럼은
  1회만 자동 증설, 등록행 append + `학생연락처` upsert, 카카오 버튼은 **클릭 이벤트만** 기록
  (`kakaoChannelAdded=true`는 공식 콜백 함수 전용), 활성 수신자 캐시 + 경량 미러.
* **발송 파이프라인**: Wix 게시 → 게시물 URL 검증 → SOLAPI 카카오 브랜드 메시지
  (`targeting=I` 강제, `disableSms:true` 고정) → 발송로그. `lastDailyTalkSentAt`은
  SOLAPI `statusCode 2000` 확인된 수신자만 갱신하고, 실패·미확인은 그대로 남깁니다.
  `TEST_MODE=true`이면 `TEST_PHONE` 한 번호로만 나갑니다.
* **프런트 제품 요구**: 선택 동의(기본 미체크, 문구 정확 일치), 트랙 추천은 기본값일 뿐
  학생 선택이 저장값, 완료 문구·스탬프, 모바일 직접 친구추가 링크 / 데스크톱 큰 QR 모달
  (외부 CDN 없는 벤더링 QR).
* **설정**: `appsscript.json` — `Asia/Seoul`, 최소 스코프 3종, 웹앱 `USER_DEPLOYING`/`ANYONE_ANONYMOUS`.
  `.gitignore`에 `.clasp.json`·`.env`·키 파일 추가.

## 테스트

```text
node tests/run-tests.js   →  81 passed, 0 failed   (4 suites, 픽스처만 사용)
node .domtest/run-dom.js  →  12 passed, 0 failed   (jsdom DOM 흐름 검증, 로컬 전용)
```

DOM 검증은 여권 열기 → 재등록/직접 입력 10회 → 과목·목표 → Daily Talk 체크 후 **Business 선택**
→ 제출 → 페이로드에 `BUSINESS`·`10`이 그대로 실리고 완료 문구·QR 모달이 동작하는지까지 봅니다.
QR은 생성한 매트릭스를 ZXing으로 디코드해 친구추가 URL이 복원되는 것을 확인했습니다.

CI 워크플로는 `.github/workflows`에 직접 커밋할 권한이 없어
`docs/daily-talk-go-live/passport-ci.yml.example`로 두었습니다(옮기면 이후 PR부터 자동 실행).

## 조사 결과 (Phase 1)

* `1P42…`(`RM 재등록 조기경보`)의 `_DB_등록신청`은 **23열(A~W)**, `학생연락처`는 26열.
  기존 코드가 가정한 배치와 열 수가 일치합니다. 다만 이 환경에서 `values.get`·Drive 내보내기가
  **모든 탭에서 타임아웃**되어 실제 헤더 문자열은 배포 후 `inspectPassportSheetHeaders()`로 확정해야 합니다.
* `RM 등록 원장(1lteVA…)`은 25KB·탭 2개로 읽기가 정상이며, DB 이전 후보 1순위입니다.
  `REGISTRATION_SPREADSHEET_ID` Script Property만 바꾸면 코드 수정 없이 옮겨집니다.
* 운영 시트 `설정` 탭에서 PF ID·targeting·TEST_MODE·TEST_PHONE 등 실값을 확인했습니다(비밀값은 없음).

## 남은 사람 단계

`docs/daily-talk-go-live/DEPLOY.md` 참고: Apps Script 프로젝트 생성(OAuth) → Script Properties
4종 + `TEST_PHONE` → `setupEnglishPassport()` → `/exec` 배포 → 실접수 1건/재제출 upsert 확인 →
SOLAPI 테스트 1건 → Wix `?passport=1` 임베드 교체.

## 보안

시크릿 4종은 코드·문서·시트에 넣지 않았고 `PropertiesService`로만 읽습니다. 저장소 전체를
스캔하는 테스트(`tests/secrets.test.js`)와 워크플로 초안의 grep 검사로 회귀를 막습니다.
테스트 전화번호·API 키는 이 PR에 포함되지 않았습니다.
