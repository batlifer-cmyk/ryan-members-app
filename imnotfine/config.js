// Supabase 프로젝트를 만든 뒤 아래 두 값만 입력하면 실시간 다중 사용자 모드가 켜집니다.
// anon key는 브라우저 공개용 키입니다. service_role key는 절대 넣지 마세요.
window.IMNOTFINE_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  STORAGE_BUCKET: "post-images",
  APP_BASE_URL: location.origin + location.pathname.replace(/index\.html$/, ""),
  DEMO_MODE: true
};
