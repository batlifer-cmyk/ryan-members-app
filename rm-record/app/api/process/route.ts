import { get } from '@vercel/blob';
import { isAuthorized } from '@/lib/auth';
import { saveRecord } from '@/lib/blob-records';
import type { AnalysisResult, DiarizedTranscript, RecordKind, RMRecord } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    speaker_map: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          speaker: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['speaker', 'label'],
      },
    },
    summary: { type: 'string' },
    key_points: { type: 'array', items: { type: 'string' } },
    next_actions: { type: 'array', items: { type: 'string' } },
    consultation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        goal: { type: 'string' },
        current_level: { type: 'string' },
        schedule: { type: 'string' },
        concerns: { type: 'array', items: { type: 'string' } },
        price_reaction: { type: 'string' },
        registration_signal: { type: 'string' },
      },
      required: ['goal', 'current_level', 'schedule', 'concerns', 'price_reaction', 'registration_signal'],
    },
    lesson: {
      type: 'object',
      additionalProperties: false,
      properties: {
        topics: { type: 'array', items: { type: 'string' } },
        corrections: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              original: { type: 'string' },
              corrected: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['original', 'corrected', 'reason'],
          },
        },
        vocabulary: { type: 'array', items: { type: 'string' } },
        grammar_focus: { type: 'array', items: { type: 'string' } },
        homework: { type: 'array', items: { type: 'string' } },
      },
      required: ['topics', 'corrections', 'vocabulary', 'grammar_focus', 'homework'],
    },
  },
  required: ['title', 'speaker_map', 'summary', 'key_points', 'next_actions', 'consultation', 'lesson'],
} as const;

function extractResponseText(payload: any) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const chunks: string[] = [];
  for (const item of payload?.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if ((content?.type === 'output_text' || content?.type === 'text') && typeof content.text === 'string') {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join('\n');
}

function kindLabel(kind: RecordKind) {
  if (kind === 'phone') return '전화상담';
  if (kind === 'in_person') return '대면상담';
  return '수업';
}

async function transcribeAudio(audio: Blob, filename: string) {
  const form = new FormData();
  form.append('file', audio, filename);
  form.append('model', 'gpt-4o-transcribe-diarize');
  form.append('response_format', 'diarized_json');
  form.append('chunking_strategy', 'auto');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`전사 실패 (${response.status}): ${detail.slice(0, 500)}`);
  }

  return (await response.json()) as DiarizedTranscript;
}

async function analyzeTranscript(input: {
  kind: RecordKind;
  subjectName: string;
  staffName: string;
  note: string;
  transcript: DiarizedTranscript;
}) {
  const segmentText = input.transcript.segments
    .map((s) => `[${s.speaker}] ${s.text}`)
    .join('\n');

  const instructions = `You analyze Ryan Members 1:1 English academy conversations.\n\nRules:\n- Never rewrite or translate the raw transcript. Analysis is separate from the raw transcript.\n- Korean/English code-switching is intentional data. Preserve quoted student utterances exactly when creating corrections.\n- Infer speaker identities only when the dialogue provides evidence. If uncertain, label them as 화자 A, 화자 B, etc.\n- For consultations, extract only information actually stated. Unknown information must be an empty string or empty array.\n- For lessons, identify student language errors only when reasonably clear from context; do not invent errors.\n- Keep the summary factual and concise.\n- registration_signal must be one of: 높음, 중간, 낮음, 판단불가, or empty string.\n- Return structured JSON only.`;

  const context = `기록 유형: ${kindLabel(input.kind)}\n대상자/학생 이름: ${input.subjectName || '미입력'}\n담당 상담자/강사: ${input.staffName || '미입력'}\n사용자 메모: ${input.note || '없음'}\n\n화자분리 전사:\n${segmentText}`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      instructions,
      input: context,
      text: {
        format: {
          type: 'json_schema',
          name: 'rm_record_analysis',
          strict: true,
          schema: ANALYSIS_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI 분석 실패 (${response.status}): ${detail.slice(0, 500)}`);
  }

  const payload = await response.json();
  const text = extractResponseText(payload);
  if (!text) throw new Error('AI 분석 결과가 비어 있습니다.');
  return JSON.parse(text) as AnalysisResult;
}

export async function POST(request: Request) {
  if (!(await isAuthorized())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
  }

  const body = (await request.json()) as {
    audioUrl?: string;
    audioPathname?: string;
    originalName?: string;
    contentType?: string;
    size?: number;
    kind?: RecordKind;
    subjectName?: string;
    staffName?: string;
    note?: string;
    consentConfirmed?: boolean;
  };

  if (!body.audioUrl || !body.audioPathname || !body.kind || !body.consentConfirmed) {
    return Response.json({ error: '필수 정보가 누락되었습니다.' }, { status: 400 });
  }

  try {
    const stored = await get(body.audioUrl);
    if (!stored || stored.statusCode !== 200 || !stored.stream) {
      throw new Error('업로드한 오디오를 읽지 못했습니다.');
    }

    const audioBlob = await new Response(stored.stream, {
      headers: { 'Content-Type': body.contentType || 'application/octet-stream' },
    }).blob();

    const transcript = await transcribeAudio(audioBlob, body.originalName || 'recording.webm');
    const analysis = await analyzeTranscript({
      kind: body.kind,
      subjectName: body.subjectName?.trim() ?? '',
      staffName: body.staffName?.trim() ?? '',
      note: body.note?.trim() ?? '',
      transcript,
    });

    const record: RMRecord = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      kind: body.kind,
      subjectName: body.subjectName?.trim() ?? '',
      staffName: body.staffName?.trim() ?? '',
      note: body.note?.trim() ?? '',
      consentConfirmed: true,
      audio: {
        url: body.audioUrl,
        pathname: body.audioPathname,
        originalName: body.originalName || 'recording.webm',
        contentType: body.contentType || 'application/octet-stream',
        size: body.size || 0,
      },
      transcript,
      analysis,
    };

    await saveRecord(record);
    return Response.json({ record });
  } catch (error) {
    const message = error instanceof Error ? error.message : '처리에 실패했습니다.';
    return Response.json({ error: message }, { status: 500 });
  }
}
