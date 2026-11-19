# /rm-magazine/{slug} — Ryan Daily Talk 기사 화면

Wix CMS 컬렉션 `RyanDailyTalkContent`의 `contentRich`(리치 텍스트)를 라이언멤버스
4단계 레슨 카드로 다시 그리는 프론트엔드 조각입니다. Wix 사이트는 Velo가 꺼져 있어
(커스텀 코드만 사용) **사용자 지정 코드(Custom Code)** 스니펫 두 줄로 이 파일들을 불러옵니다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `rm-daily-talk.css` | 기사 카드·타이포·간격, 하단 CTA 카드, 하단 여백, 플로팅 수강료 계산기 버튼 크기 조정 |
| `rm-daily-talk.js` | 리치 텍스트를 Step 1~4로 파싱해 카드로 재구성, `contentId`/`slug` 노출 숨김, 글 맨 아래 Daily Talk CTA 삽입 |

동작 원리:

1. `contentRich`는 `STEP 1 · KEY CHUNKS` … `STEP 4 · MODEL & YOUR TURN` 제목과 문단으로
   게시됩니다(`DailyTalkWixPublisher.gs`의 `buildDailyTalkLessonBlocks_`).
2. 스크립트가 그 텍스트를 읽어 ① 핵심 청크 ② 어순 훈련 ③ AAA/Message House ④ 모델·미션
   카드로 다시 그립니다. 파싱에 실패하면 **원래 리치 텍스트를 그대로 둡니다**(안전한 기본값).
3. 원문을 숨긴 뒤에만 카드가 보이므로, 스크립트가 없거나 실패해도 글은 읽힙니다.
4. 카드 아래에는 `Ryan Daily Talk` CTA 카드가 하나 붙습니다. 버튼 하나와 작은 링크 두 개로
   구성되고, 셋 다 **이미 있는 실서비스 주소**만 가리킵니다(새 도메인·새 폼을 만들지 않음).

| 요소 | 링크 | 이유 |
| --- | --- | --- |
| `Daily Talk 무료로 받기` (메인 버튼) | `https://www.ryanmembers.com/?dailytalk=1` | 이름·휴대폰·트랙만 받는 전용 화면(`/exec?mode=dailytalk`). 비수강생도 바로 신청할 수 있고 `_DB_등록신청`에 기록을 남기지 않는다 |
| `트랙 변경` | 같은 전용 주소 | 같은 번호로 제출하면 `학생연락처`의 Daily Talk 셀만 바뀐다(`submitDailyTalkOnly`) |
| `카카오톡 채널 추가` | `https://pf.kakao.com/_xkFxexfX/friend` | `BMS_TARGETING=I`라 채널 친구가 아니면 발송되지 않음 |

## Wix 설정 (사용자 지정 코드)

`manage.wix.com → 설정 → 사용자 지정 코드`에서 두 개를 추가합니다.

| 이름 | 위치 | 적용 페이지 | 코드 |
| --- | --- | --- | --- |
| `RM Daily Talk · 기사 스타일` | Head | 선택 페이지 → **Ryan Daily Talk 콘텐츠 (Item)** | `<link>` 한 줄 |
| `RM Daily Talk · 기사 4단계 카드` | Body - 끝 | 선택 페이지 → **Ryan Daily Talk 콘텐츠 (Item)** | `<script>` 한 줄 |

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/batlifer-cmyk/ryan-members-app@<COMMIT_SHA>/wix/rm-magazine/rm-daily-talk.css">
<script src="https://cdn.jsdelivr.net/gh/batlifer-cmyk/ryan-members-app@<COMMIT_SHA>/wix/rm-magazine/rm-daily-talk.js" defer></script>
```

`<COMMIT_SHA>`는 이 파일이 들어 있는 커밋입니다. 스타일을 고칠 때는 커밋을 올리고
스니펫의 SHA만 바꿉니다(커밋 고정 URL이라 캐시가 안전합니다).

## 확인

```bash
# 390×844 모바일 화면으로 실제 페이지 확인
node .scratch/pw/inject.js <url> out.png 390   # 로컬 주입 확인(개발용)
```

실서비스 확인은 `https://www.ryanmembers.com/rm-magazine/{slug}` 를 휴대폰으로 열어
① Step 1~4 카드 ② 제목 아래 `contentId`/`slug` 미노출 ③ 하단 문단이 플로팅 버튼에
가리지 않는지를 봅니다.
