# Quietly Fluent — Ryan Members Wix 통합판

이 폴더는 독립 PWA가 아니라 `www.ryanmembers.com`의 Wix 회원 페이지 안에서 실행되는 학습앱입니다.

## 구성

- `site/embed.html`: Wix HTML 구성요소에 직접 넣을 단일 파일
- `site/index.html`, `site/styles.css`, `site/data.js`, `site/app.js`: 유지보수용 분리 소스
- `wix-page-code.js`: Quietly Fluent 페이지의 Velo 페이지 코드
- `backend/quietlyFluent.web.js`: 회원 인증·CMS 저장을 담당하는 Velo 백엔드 웹 모듈

## 이미 생성된 Wix CMS 컬렉션

라이언멤버스 실사이트에 아래 컬렉션이 생성되어 있습니다.

1. `QuietlyFluentStudents` — 회원별 전체 상태·진도·평균 지표
2. `QuietlyFluentLessonLogs` — 회차별 WTC·불안·성공 발화·M–F–R 피드백

두 컬렉션은 방문자가 직접 읽거나 쓰지 못하도록 ADMIN 권한으로 두고, `Permissions.SiteMember` 백엔드 웹 메서드만 통과하게 했습니다.

## Wix Editor 설치

1. 새 페이지를 만들고 URL 슬러그를 `quietly-fluent`로 설정합니다.
2. 페이지 권한을 `사이트 회원만`으로 설정합니다.
3. HTML 임베드 요소를 페이지 전체 폭으로 추가하고 ID를 `quietlyFluentHtml`로 설정합니다.
4. HTML 요소의 코드 입력란에 배포 패키지의 `site/embed.html` 전체를 붙여넣습니다.
5. 페이지 코드에 `wix-page-code.js`를 붙여넣습니다.
6. 백엔드에 `quietlyFluent.web.js` 파일을 만들고 `backend/quietlyFluent.web.js`를 붙여넣습니다.
7. 데스크톱 높이는 약 1100px, 모바일은 약 900px 이상으로 시작한 뒤 미리보기에서 조정합니다.
8. 게시한 실제 사이트에서 로그인·저장·재접속 복원을 확인합니다. Wix 회원 API는 에디터 미리보기보다 게시 사이트에서 완전하게 작동합니다.

## 보안 구조

- 학생은 Wix 회원 로그인을 거쳐야 앱을 열 수 있습니다.
- memberId는 iframe이 보내지 않고 백엔드 세션에서 직접 확인합니다.
- CMS는 ADMIN 전용이며 프런트엔드가 직접 접근하지 않습니다.
- HTML iframe과 Wix 페이지는 `postMessage`로만 통신합니다.
- 강사 모드는 Admin/Teacher/Instructor/강사/운영/원장/대표 역할에만 표시됩니다.

## 현재 범위

- 학생 자신의 16회 학습 기록 저장 및 여러 기기 복원
- WTC·불안·피로·Message House·성공 발화 기록
- 회차 완료와 운영용 CMS 로그 축적
- 강사 역할의 현재 계정용 강사 모드

운영팀이 여러 학생을 검색하고 피드백하는 통합 대시보드는 다음 단계로 분리하는 것이 안전합니다.
