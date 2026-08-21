import { get, list, put } from '@vercel/blob';
import type { RMRecord } from './types';

const RECORD_PREFIX = 'rm-record/records/';

export async function saveRecord(record: RMRecord) {
  const date = record.createdAt.slice(0, 10);
  return put(`${RECORD_PREFIX}${date}/${record.id}.json`, JSON.stringify(record), {
    access: 'private',
    addRandomSuffix: false,
    contentType: 'application/json; charset=utf-8',
  });
}

async function readJsonBlob<T>(url: string): Promise<T> {
  const result = await get(url, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error('저장된 기록을 읽지 못했습니다.');
  }
  const text = await new Response(result.stream).text();
  return JSON.parse(text) as T;
}

export async function listRecentRecords(limit = 20) {
  const result = await list({ prefix: RECORD_PREFIX, limit: Math.min(limit, 50) });
  const sorted = [...result.blobs].sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
  );

  return Promise.all(
    sorted.slice(0, limit).map(async (blob) => {
      const record = await readJsonBlob<RMRecord>(blob.url);
      return {
        id: record.id,
        createdAt: record.createdAt,
        kind: record.kind,
        subjectName: record.subjectName,
        staffName: record.staffName,
        title: record.analysis.title,
        summary: record.analysis.summary,
        duration: record.transcript.duration,
      };
    }),
  );
}
