export type RecordKind = 'phone' | 'in_person' | 'lesson';

export type TranscriptSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker: string;
};

export type DiarizedTranscript = {
  task?: string;
  duration: number;
  text: string;
  segments: TranscriptSegment[];
  usage?: unknown;
};

export type AnalysisResult = {
  title: string;
  speaker_map: Array<{ speaker: string; label: string }>;
  summary: string;
  key_points: string[];
  next_actions: string[];
  consultation: {
    goal: string;
    current_level: string;
    schedule: string;
    concerns: string[];
    price_reaction: string;
    registration_signal: string;
  };
  lesson: {
    topics: string[];
    corrections: Array<{ original: string; corrected: string; reason: string }>;
    vocabulary: string[];
    grammar_focus: string[];
    homework: string[];
  };
};

export type RMRecord = {
  id: string;
  createdAt: string;
  kind: RecordKind;
  subjectName: string;
  staffName: string;
  note: string;
  consentConfirmed: boolean;
  audio: {
    url: string;
    pathname: string;
    originalName: string;
    contentType: string;
    size: number;
  };
  transcript: DiarizedTranscript;
  analysis: AnalysisResult;
};
