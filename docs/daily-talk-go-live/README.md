# English Passport + Ryan Daily Talk — Go-Live 구현 정리

작성: 2026-11-18 · 브랜치 `claude/daily-talk-go-live` · 담당: 아르뢀(백그라운드 작업)

목표 문서: `CLAUDE_TASK_DAILY_TALK_GO_LIVE.md` (Phase 1~8) 중 **Phase 1~3 + 배포 준비까지**.
실서비스 전환(`TEST_MODE=false`)과 실제 학생 발송은 이번 범위에서 **하지 않았다**.

---

## 1. 무엇이 바뀌었나 (변경 파일)

| 파일 | 상태 | 내용 |
| --- | --- | --- |
| `apps-script/PassportCore.gs` | 신규 | 순수 함수 계층. 전화번호 정규화, 트랙 추천/최종 선택, 회차 계산, 페이로드 검증, 수신자 필터, 발송 계획(중복·멱등), SOLAPI 응답 해석, 헤더→컬럼 매핑. Google API를 전혀 호출하지 않는다. |
| `apps-script/Index.html` | 신규 | 단일 페이지 영어여권. 다중 iframe/CDN 체인 대체. 커스텀 회차·전체 과목 목록·Daily Talk 선택 동의·트랙 최종 선택·완료 문구·모바일 직접 친구추가/데스크톱 QR 모달 포함. `google.script.run.submitPassport`로 실제 제출. |
| `apps-script/QRCode.html` | 신규 | 데스크톱 QR용 `qrcode-generator` v1.4.4(MIT) 인라인 벤더링. 외부 CDN 요청 없음. |
| `apps-script/EnglishPassportBackend.gs` | 재작성 | `doGet()`이 `Index.html`을 직접 서빙(`XFrameOptionsMode.ALLOWALL`), 헤더 이름 기반 컬럼 매핑·자동 증설, 등록 행 append + `학생연락처` upsert, 클릭 이벤트 기록(`kakaoChannelAdded`는 콜백 전용), 활성 수신자 추출 + 캐시 + 발송대상 미러. |
| `apps-script/DailyTalkWixPublisher.gs` | 재작성 | Wix 게시 → URL 검증 → SOLAPI 카카오 브랜드 메시지(targeting `I`, `disableSms:true`) → 발송로그 → 성공 시에만 `lastDailyTalkSentAt` 갱신. TEST_MODE 게이트, `contentId+phone` 멱등, 수신자별 결과 해석. |
| `apps-script/appsscript.json` | 신규 | `Asia/Seoul`, 최소 스코프 3종, 웹앱 `USER_DEPLOYING` / `ANYONE_ANONYMOUS`. |
| `tests/` | 신규 | Node 순수 단위 테스트 4개 스위트 + 픽스처 + 러너 (`node tests/run-tests.js`). |
| `package.json` | 신규 | `npm test` → `node tests/run-tests.js`. |
| `.gitignore` | 신규 | `.clasp.json`, `.clasprc.json`, `.env*`, 키·자격증명 파일, `node_modules/`. |
| `docs/daily-talk-go-live/passport-ci.yml.example` | 신규 | 단위 테스트 + 시크릿 리터럴 스캔 워크플로 초안. GitHub App 토큰에 `workflows` 권한이 없어 `.github/workflows/`에 직접 커밋하지 못했다. 대표가 파일을 `.github/workflows/passport-ci.yml`로 옮기면 이후 PR부터 자동 실행된다. |
| `docs/daily-talk-go-live/*` | 신규 | 이 문서, 배포 절차, 시트 구조 조사 결과. |

기존 `passport-v3-loader.html` ~ `passport-v7-channel-cta.html`, `passport-preview.html`은
**손대지 않았다.** 지금 Wix 미리보기가 그 파일들을 가리킬 수 있어, 수용 테스트 통과 전에는
지우거나 옮기지 않는 것이 안전하다. 새 아키텍처에서는 사용되지 않으며, 전환 후 삭제 대상이다.

---

## 2. 아키텍처 (전 / 후)

```text
[전]
Wix ?passport=1 → v7(iframe) → v5(iframe) → v3 loader(fetch+패치) → passport-preview.html
                 + 각 단계가 교차 프레임 DOM 주입, 제출은 상위 프레임이 가로채는 구조
                 + google.script.run이 없으면 PREVIEW-DEMO로 가짜 성공 처리

[후]
Wix ?passport=1 → Apps Script /exec (doGet) → Index.html (단일 문서)
                                          → google.script.run.submitPassport
                                          → _DB_등록신청 append + 학생연락처 upsert
```

* 교차 프레임 DOM 조작, CDN 로더, 미리보기 mock 제출이 모두 사라졌다.
* QR도 외부 CDN 없이 인라인 라이브러리로 그린다(오프라인/차단 환경에서도 동작).
* `google.script.run`이 없는 화면(정적 파일로 연 경우)은 경고를 띄우고 제출 버튼을 잠근다.

---

## 3. 제품 요구사항 대응표

| 요구사항 | 구현 위치 | 검증 |
| --- | --- | --- |
| 별도 Google Form/Wix 신청서 없음 | `Index.html` 단일 폼 | 프런트 계약 테스트 |
| 영어여권 전화번호 재사용 | `collect()` → `submitPassport` | DOM 테스트 |
| 학생명·정규화 전화·등록구분·회차(커스텀 포함)·과목·강사·목표·개인정보 동의 | `Index.html` 1~4페이지 | DOM 테스트 |
| Daily Talk 동의는 **선택**, 기본 미체크 | `#dailyTalkOptIn` (checked 없음) | 프런트 계약 테스트 |
| 동의 문구 정확 일치 | 동의 라벨 텍스트 | 문자열 정확 비교 |
| 최종 트랙 선택 `SMALL_TALK`/`BUSINESS`/`BOTH` | 라디오 3종 + `resolveDailyTalkTrack` | 단위 테스트 |
| 과목 기반은 추천/기본값일 뿐, 학생 선택이 우선 | `classifyDailyTalkTrack` vs `dailyTalkTrack` | 단위 테스트(BUSINESS 선택 → BUSINESS 저장) |
| 완료 문구 `영어로 여는 새로운 세계…` | 5페이지 | DOM 테스트(순서 검사) |
| 완료 화면 카카오 채널 CTA 강화 | 모바일 직접 링크 / 데스크톱 큰 QR 모달 | DOM 테스트 + QR 디코드 검증 |
| `kakaoChannelAdded=true` 임의 설정 금지 | 클릭은 `kakaoChannelClickAt`만, `true`는 콜백 함수 전용 | 단위·프런트 계약 테스트 |
| 스토리지 7개 필드 | 두 시트 헤더 스펙에 모두 포함 | 단위 테스트(컬럼 매핑) |
| 기존 번호는 갱신, 신규 번호는 추가 | `upsertContactRow_` | 단위 테스트(로직) + 배포 후 실검증 필요 |
| ACTIVE 수신자 필터 | `filterActiveRecipients` | 단위 테스트(픽스처 7행) |
| 발송 흐름(Wix→URL→카카오→로그) | `runDailyTalkPipeline` | 단위 테스트(SOLAPI 응답 해석) |
| `BOTH`는 각 트랙 수신, 같은 콘텐츠 중복 없음 | `buildSendPlan` | 단위 테스트 |
| 실패를 성공으로 기록하지 않음 | `parseSolapiResponse` + 상태 매핑 | 단위 테스트 |
| `contentId+phone` 멱등 | `buildSendKey`, 발송로그 색인 | 단위 테스트 |
| 비밀키는 Script Properties만 | `getScriptProperty_` | 시크릿 스캔 테스트 |

---

## 4. 테스트 결과

```text
$ node tests/run-tests.js
Passport/Daily Talk unit tests (4 suites)
81 passed, 0 failed
```

포함 범위:

* `phone-audience.test.js` — 전화번호 정규화(국가번호·구형 011·전각 숫자), 수신자 필터/중복 제거/트랙 선택
* `payload.test.js` — 페이로드 정규화·검증, 커스텀 회차, 트랙 우선순위, 동의 버전/시각, `kakaoChannelAdded` 차단, 등록행/연락처행 필드
* `send-plan.test.js` — BOTH 중복 방지, 멱등 스킵, 수신자 상한, SOLAPI 응답 해석(2000만 성공), Wix URL 검증, 메시지 본문, 헤더→컬럼 매핑
* `frontend-contract.test.js` — `Index.html` 제품 문구/구조 계약, `.gs` 로드·export 계약, 상수 고정, 매니페스트
* `secrets.test.js` — 저장소 내 시크릿 리터럴·JWT·테스트 전화번호 부재, `.gitignore` 확인

DOM 수준 검증(로컬, jsdom — 저장소 CI에는 미포함):

```text
$ node .domtest/run-dom.js
12 passed, 0 failed
```

여권 열기 → 이름/전화 입력(자동 하이픈) → 재등록 + 직접 입력 10회 → 과목/목표 →
Daily Talk 체크 후 **Business 선택(추천과 다름)** → 제출 → 페이로드에 `BUSINESS`/`10`이
그대로 실림 → 완료 문구 순서 → 데스크톱 버튼이 QR 모달을 열고 클릭 이벤트만 기록.

QR 정확성: 벤더링한 라이브러리로 생성한 매트릭스를 ZXing으로 디코드해
`https://pf.kakao.com/_xkFxexfX/friend`가 복원되는 것을 확인했다.

---

## 5. 아직 사람이 해야 하는 일 (요약)

1. Apps Script 프로젝트 생성/로그인(clasp) — OAuth 승인 필요
2. Script Properties 4종 + `TEST_PHONE` 입력 (비밀값은 채팅/시트/코드에 남기지 않음)
3. 웹앱 배포(`/exec`) 후 실접수 1건 + 재제출 upsert 확인
4. SOLAPI 카카오 테스트 1건(운영자 본인 번호, 채널 친구 상태)
5. Wix `?passport=1` 임베드 URL 교체

자세한 절차는 `DEPLOY.md`, 시트 구조 조사는 `DB-STRUCTURE.md` 참고.
