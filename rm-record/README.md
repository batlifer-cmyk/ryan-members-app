# RM Record V1

Ryan Members의 전화상담, 대면상담, 1:1 수업 녹음을 화자분리 전사하고 상담·수업 유형별로 구조화하여 저장하는 내부 웹앱입니다.

## V1 기능

- 전화상담 / 대면상담 / 수업 구분
- 브라우저 마이크 녹음(음성 중심 32kbps)
- 기존 m4a/mp3/wav/webm/ogg/mp4 음성파일 업로드
- 브라우저에서 약 3MB 단위로 분할하여 서버에 업로드
- 모든 업로드 조각과 최종 원본을 Vercel Blob **Private Storage**에만 저장
- 처리 완료/실패 후 임시 업로드 조각 자동 삭제
- `gpt-4o-transcribe-diarize` 화자분리 전사
- 원문 전사 보존: 번역·문장 교정 없음
- AI 상담 요약 / 핵심정보 / 다음 조치 추출
- AI 수업 주제 / 교정표현 / 어휘 / 문법 분석
- 원본 오디오와 JSON 기록을 Private Blob에 분리 보관
- 공유 접근키 기반 내부 로그인
- 최근 기록 목록
- `/api/health` 환경설정 상태 확인(로그인 후)

## 파일 크기

OpenAI diarization 전사 요청은 파일당 25MB 제한이 있으므로 V1은 안전 여유를 두어 **24MB**까지 허용합니다. 앱에서 직접 녹음할 때는 약 32kbps로 저장하므로 일반적인 60분 수업은 이 범위 안에 들어오도록 설계했습니다.

24MB를 넘는 기존 고비트레이트 녹음은 V2에서 자동 음성 압축/시간단위 분할 전사를 추가할 예정입니다.

## 필요한 환경변수

```bash
OPENAI_API_KEY=...
BLOB_READ_WRITE_TOKEN=...
RM_RECORD_ACCESS_KEY=...
```

`RM_RECORD_ACCESS_KEY`는 직원들이 앱에 접속할 때 사용할 긴 내부 비밀번호입니다. 브라우저에는 서버 원문 키를 저장하지 않고 HttpOnly 세션 쿠키만 사용합니다.

## Vercel 설정

1. 이 저장소를 Vercel 프로젝트로 Import합니다.
2. **Root Directory**를 `rm-record`로 지정합니다.
3. Vercel Blob Store를 프로젝트에 연결하고 **Private** storage를 사용합니다.
4. `OPENAI_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `RM_RECORD_ACCESS_KEY`를 Environment Variables에 추가합니다.
5. 배포합니다.
6. 로그인 후 `/api/health`에서 `ok: true`를 확인합니다.

## 처리 흐름

```text
브라우저 녹음/파일 선택
  → 3MB 단위 분할
  → 서버가 Private Blob 임시조각으로 저장
  → /api/process에서 비공개 조각 재조립
  → OpenAI gpt-4o-transcribe-diarize
  → 원문 화자분리 전사
  → GPT 구조화 분석
  → 최종 원본 오디오를 Private Blob에 저장
  → JSON record를 Private Blob에 저장
  → 임시조각 삭제
```

## 데이터 원칙

1. **원본 오디오**와 **원문 전사**는 AI 요약과 분리합니다.
2. 한글/영어 code-switching은 번역하지 않습니다.
3. AI가 추측한 상담정보는 원문을 대체하지 않습니다.
4. 사용자는 녹음 및 내부 처리 동의를 확인해야 처리 버튼을 누를 수 있습니다.
5. 화자 신원은 대화 문맥으로 추정하며, 확신이 없으면 `화자 A/B`로 남깁니다.
6. 음성은 public Blob 경로에 저장하지 않습니다.

## CI

`.github/workflows/rm-record-ci.yml`에서 Node 22 기준으로 의존성을 설치한 뒤 `next build`를 실행합니다. PR 병합 전 CI가 통과해야 합니다.

## 후속 확장

- 기존 Ryan Members 학생/강사 DB와 자동 연결
- 상담정보 → rmmatch 스케줄러 자동 전달
- 1회/8회/16회 수업 longitudinal progress 분석
- 녹음 동의 로그 및 보존/삭제 정책 관리
- 24MB 초과 오디오 자동 압축·분할 전사
- 역할 기반 로그인(관리자/상담자/강사)
