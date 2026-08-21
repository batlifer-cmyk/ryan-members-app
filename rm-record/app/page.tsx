'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RMRecord, RecordKind } from '@/lib/types';

type RecentRecord = {
  id: string;
  createdAt: string;
  kind: RecordKind;
  subjectName: string;
  staffName: string;
  title: string;
  summary: string;
  duration: number;
};

type UploadedChunk = {
  url: string;
  pathname: string;
  index: number;
  size: number;
};

const CHUNK_SIZE = 3 * 1024 * 1024;
const MAX_FILE_SIZE = 24 * 1024 * 1024;

const kindMeta: Record<RecordKind, { label: string; caption: string }> = {
  phone: { label: '전화상담', caption: '통화 녹음파일을 올려 전사합니다.' },
  in_person: { label: '대면상담', caption: '상담 자리에서 바로 녹음합니다.' },
  lesson: { label: '수업', caption: '한·영 혼용 발화를 그대로 보존합니다.' },
};

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function safeExtension(name: string, type: string) {
  const match = name.match(/\.([a-z0-9]{2,5})$/i);
  if (match) return `.${match[1].toLowerCase()}`;
  if (type.includes('webm')) return '.webm';
  if (type.includes('mp4') || type.includes('m4a')) return '.m4a';
  if (type.includes('wav')) return '.wav';
  if (type.includes('mpeg') || type.includes('mp3')) return '.mp3';
  if (type.includes('ogg')) return '.ogg';
  return '.audio';
}

async function deleteTemporaryUpload(uploadId: string) {
  try {
    await fetch('/api/blob/chunk', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId }),
    });
  } catch {
    // Server-side processing also performs cleanup. This is only best effort.
  }
}

export default function Home() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [accessKey, setAccessKey] = useState('');
  const [authError, setAuthError] = useState('');

  const [kind, setKind] = useState<RecordKind>('phone');
  const [subjectName, setSubjectName] = useState('');
  const [staffName, setStaffName] = useState('');
  const [note, setNote] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<RMRecord | null>(null);
  const [recent, setRecent] = useState<RecentRecord[]>([]);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const recordedChunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkAuth = useCallback(async () => {
    const response = await fetch('/api/auth', { cache: 'no-store' });
    const data = await response.json();
    setAuthenticated(Boolean(data.authenticated));
    setAuthChecked(true);
  }, []);

  const loadRecent = useCallback(async () => {
    const response = await fetch('/api/records', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    setRecent(data.records ?? []);
  }, []);

  useEffect(() => { void checkAuth(); }, [checkAuth]);
  useEffect(() => { if (authenticated) void loadRecent(); }, [authenticated, loadRecent]);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    mediaStream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const speakerMap = useMemo(() => {
    const map = new Map<string, string>();
    result?.analysis.speaker_map.forEach((entry) => map.set(entry.speaker, entry.label));
    return map;
  }, [result]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setAuthError('');
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey }),
    });
    const data = await response.json();
    if (!response.ok) {
      setAuthError(data.error || '로그인에 실패했습니다.');
      return;
    }
    setAccessKey('');
    setAuthenticated(true);
  }

  async function logout() {
    await fetch('/api/auth', { method: 'DELETE' });
    setAuthenticated(false);
    setResult(null);
  }

  async function startRecording() {
    setError('');
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      mediaStream.current = stream;
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 },
      );
      recordedChunks.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordedChunks.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunks.current, { type: recorder.mimeType || 'audio/webm' });
        const ext = safeExtension('recording', blob.type);
        setFile(new File([blob], `rm-record-${Date.now()}${ext}`, { type: blob.type }));
        mediaStream.current?.getTracks().forEach((track) => track.stop());
        mediaStream.current = null;
      };
      recorder.start(1000);
      mediaRecorder.current = recorder;
      setRecordingSeconds(0);
      timer.current = setInterval(() => setRecordingSeconds((value) => value + 1), 1000);
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '마이크를 시작하지 못했습니다.');
    }
  }

  function stopRecording() {
    mediaRecorder.current?.stop();
    mediaRecorder.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRecording(false);
  }

  async function uploadInPrivateChunks(target: File, uploadId: string) {
    const total = Math.ceil(target.size / CHUNK_SIZE);
    const chunks: UploadedChunk[] = [];

    for (let index = 0; index < total; index += 1) {
      const start = index * CHUNK_SIZE;
      const end = Math.min(target.size, start + CHUNK_SIZE);
      const part = target.slice(start, end, 'application/octet-stream');
      setStatus(`1/3 음성파일을 비공개로 업로드하고 있습니다… ${index + 1}/${total}`);

      const response = await fetch(`/api/blob/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: part,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `업로드 조각 ${index + 1} 저장에 실패했습니다.`);
      chunks.push(data.chunk as UploadedChunk);
    }

    return chunks;
  }

  async function processRecord() {
    if (!file) return setError('녹음하거나 음성파일을 선택해 주세요.');
    if (!consentConfirmed) return setError('녹음·내부 분석 동의 확인이 필요합니다.');
    if (file.size > MAX_FILE_SIZE) return setError('전사 가능한 파일은 최대 24MB입니다. 앱에서 직접 녹음하면 32kbps로 저장되어 긴 수업도 용량을 줄일 수 있습니다.');

    setError('');
    setResult(null);
    const uploadId = crypto.randomUUID();
    let uploaded = false;

    try {
      const chunks = await uploadInPrivateChunks(file, uploadId);
      uploaded = true;

      setStatus('2/3 화자를 구분하며 전사하고 있습니다…');
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          chunks,
          originalName: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          kind,
          subjectName,
          staffName,
          note,
          consentConfirmed,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '처리에 실패했습니다.');

      setStatus('3/3 상담·수업 내용을 구조화하고 기록했습니다.');
      setResult(data.record);
      await loadRecent();
    } catch (e) {
      setStatus('');
      setError(e instanceof Error ? e.message : '처리에 실패했습니다.');
      if (!uploaded) await deleteTemporaryUpload(uploadId);
    }
  }

  if (!authChecked) return <main className="center"><div className="loader">RM RECORD</div></main>;

  if (!authenticated) {
    return (
      <main className="center">
        <form className="login-card" onSubmit={login}>
          <div className="eyebrow">RYAN MEMBERS</div>
          <h1>RM RECORD</h1>
          <p>상담과 수업의 음성을 기록 가능한 데이터로 변환합니다.</p>
          <label>내부 접근키</label>
          <input type="password" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} autoFocus />
          {authError && <div className="error">{authError}</div>}
          <button className="primary" type="submit">접속</button>
        </form>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">RYAN MEMBERS · CONVERSATION INTELLIGENCE</div>
          <h1>RM RECORD</h1>
        </div>
        <button className="ghost small" onClick={logout}>로그아웃</button>
      </header>

      <div className="grid">
        <section className="panel capture-panel">
          <h2>새 기록</h2>
          <div className="kind-grid">
            {(Object.keys(kindMeta) as RecordKind[]).map((key) => (
              <button key={key} className={`kind-card ${kind === key ? 'active' : ''}`} onClick={() => setKind(key)}>
                <strong>{kindMeta[key].label}</strong>
                <span>{kindMeta[key].caption}</span>
              </button>
            ))}
          </div>

          <div className="form-grid">
            <label>
              <span>{kind === 'lesson' ? '학생 이름' : '상담 대상자'}</span>
              <input value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="예: 김하정" />
            </label>
            <label>
              <span>{kind === 'lesson' ? '담당 강사' : '상담자'}</span>
              <input value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="예: Matthew" />
            </label>
          </div>

          <label className="full-label">
            <span>메모 · 과정명 · 특이사항</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 간호영어면접 / 화·목 19시 이후" />
          </label>

          <div className="record-box">
            <div className="record-actions">
              {!recording ? (
                <button className="record-button" onClick={startRecording}><span className="dot" /> 녹음 시작</button>
              ) : (
                <button className="record-button stop" onClick={stopRecording}><span className="square" /> 녹음 종료 · {formatTime(recordingSeconds)}</button>
              )}
              <span className="or">또는</span>
              <label className="file-button">
                녹음파일 선택
                <input
                  type="file"
                  accept="audio/*,video/mp4,.m4a,.mp3,.wav,.webm,.ogg,.mp4"
                  onChange={(e) => {
                    const selected = e.target.files?.[0] ?? null;
                    setFile(selected);
                    setError(selected && selected.size > MAX_FILE_SIZE ? '이 파일은 24MB를 초과합니다. 더 낮은 비트레이트의 음성파일을 사용해 주세요.' : '');
                  }}
                />
              </label>
            </div>
            {file && (
              <div className="file-info">
                <strong>{file.name}</strong>
                <span>{(file.size / 1024 / 1024).toFixed(1)} MB · {file.type || 'audio'}</span>
              </div>
            )}
          </div>

          <label className="consent">
            <input type="checkbox" checked={consentConfirmed} onChange={(e) => setConsentConfirmed(e.target.checked)} />
            <span>녹음 사실 및 라이언멤버스 내부 전사·분석 처리에 대한 동의를 확인했습니다.</span>
          </label>

          {error && <div className="error">{error}</div>}
          {status && <div className="status">{status}</div>}

          <button className="primary process" disabled={!file || recording || file.size > MAX_FILE_SIZE} onClick={processRecord}>
            전사 및 분석 시작
          </button>
        </section>

        <aside className="panel recent-panel">
          <div className="section-head"><h2>최근 기록</h2><button className="ghost small" onClick={loadRecent}>새로고침</button></div>
          <div className="recent-list">
            {recent.length === 0 && <p className="muted">저장된 기록이 아직 없습니다.</p>}
            {recent.map((item) => (
              <article className="recent-item" key={item.id}>
                <div className="recent-meta"><span>{kindMeta[item.kind].label}</span><span>{formatDate(item.createdAt)}</span><span>{formatTime(item.duration)}</span></div>
                <strong>{item.title || item.subjectName || '제목 없음'}</strong>
                <p>{item.summary}</p>
              </article>
            ))}
          </div>
        </aside>
      </div>

      {result && (
        <section className="results">
          <div className="panel result-summary">
            <div className="result-title">
              <div><div className="eyebrow">ANALYSIS COMPLETE</div><h2>{result.analysis.title}</h2></div>
              <span className="duration">{formatTime(result.transcript.duration)}</span>
            </div>
            <p className="lead">{result.analysis.summary}</p>

            <div className="two-col">
              <div><h3>핵심 내용</h3><ul>{result.analysis.key_points.map((v, i) => <li key={i}>{v}</li>)}</ul></div>
              <div><h3>다음 조치</h3><ul>{result.analysis.next_actions.map((v, i) => <li key={i}>{v}</li>)}</ul></div>
            </div>

            {result.kind !== 'lesson' ? (
              <div className="fact-grid">
                <div><span>목표</span><strong>{result.analysis.consultation.goal || '—'}</strong></div>
                <div><span>현재 수준</span><strong>{result.analysis.consultation.current_level || '—'}</strong></div>
                <div><span>희망 일정</span><strong>{result.analysis.consultation.schedule || '—'}</strong></div>
                <div><span>등록 신호</span><strong>{result.analysis.consultation.registration_signal || '판단불가'}</strong></div>
                <div><span>가격 반응</span><strong>{result.analysis.consultation.price_reaction || '—'}</strong></div>
                <div><span>고민</span><strong>{result.analysis.consultation.concerns.join(' · ') || '—'}</strong></div>
              </div>
            ) : (
              <div className="lesson-analysis">
                <h3>수업 분석</h3>
                <div className="chips">{result.analysis.lesson.topics.map((v, i) => <span key={i}>{v}</span>)}</div>
                {result.analysis.lesson.corrections.length > 0 && (
                  <div className="corrections">
                    {result.analysis.lesson.corrections.map((c, i) => (
                      <div className="correction" key={i}><del>{c.original}</del><strong>{c.corrected}</strong><small>{c.reason}</small></div>
                    ))}
                  </div>
                )}
                <div className="two-col">
                  <div><h3>어휘</h3><ul>{result.analysis.lesson.vocabulary.map((v, i) => <li key={i}>{v}</li>)}</ul></div>
                  <div><h3>문법 포커스</h3><ul>{result.analysis.lesson.grammar_focus.map((v, i) => <li key={i}>{v}</li>)}</ul></div>
                </div>
              </div>
            )}
          </div>

          <div className="panel transcript-panel">
            <div className="section-head"><div><div className="eyebrow">RAW TRANSCRIPT</div><h2>원문 전사</h2></div><span className="muted">번역·문장 재작성 없음</span></div>
            <div className="transcript">
              {result.transcript.segments.map((segment) => (
                <div className="segment" key={segment.id}>
                  <div className="speaker"><strong>{speakerMap.get(segment.speaker) || `화자 ${segment.speaker}`}</strong><span>{formatTime(segment.start)}</span></div>
                  <p>{segment.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <footer>RM Record V1 · 원본 오디오와 원문 전사, AI 분석을 분리 저장합니다.</footer>
    </main>
  );
}
