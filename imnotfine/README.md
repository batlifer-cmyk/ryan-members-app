# I'm Not Fine v2

인스타그램의 하이라이트 문화와 반대되는 소규모 사진 SNS 프로토타입입니다.

## 현재 동작

- 데모 모드: 설정 없이 즉시 실행, 브라우저 LocalStorage 저장
- 라이브 모드: Supabase 이메일 로그인, 서클, 게시물, 반응 동기화
- 카메라/사진첩 게시, 하루 한 장 UX, 7일 만료
- 서클 생성·초대 코드 참여·딥링크
- 인스타그램 9:16 티저 카드 생성 및 Web Share
- 신고·차단·위험 문구 게시 중단
- PWA 설치와 Android Share Target(Service Worker가 공유 사진을 수신)

## Supabase 연결

1. Supabase 프로젝트 생성
2. SQL Editor에서 `supabase-schema.sql` 실행
3. Authentication > URL Configuration에 배포 주소를 Site URL/Redirect URL로 추가
4. `config.js`에 Project URL과 `anon public` key 입력
5. `DEMO_MODE: false`로 변경

```js
window.IMNOTFINE_CONFIG = {
  SUPABASE_URL: "https://PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "PUBLIC_ANON_KEY",
  STORAGE_BUCKET: "post-images",
  APP_BASE_URL: "https://example.com/imnotfine/",
  DEMO_MODE: false
};
```

`service_role` key는 브라우저 코드에 절대 넣지 않습니다.

## 배포

정적 파일이므로 GitHub Pages, Cloudflare Pages, Netlify, Vercel에서 배포할 수 있습니다. PWA와 Share Target은 HTTPS가 필요합니다.

## 다음 제품 단계

- 관리자 신고 검수 화면
- 이미지 안전성 분류 API를 서버 함수로 연결
- iOS Share Extension을 포함한 Capacitor/Swift 패키지
- 푸시 알림과 서클 활동 요약
- 개인정보처리방침·이용약관·연령 게이트
