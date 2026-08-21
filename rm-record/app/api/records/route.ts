import { isAuthorized } from '@/lib/auth';
import { listRecentRecords } from '@/lib/blob-records';

export async function GET() {
  if (!(await isAuthorized())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return Response.json({ records: await listRecentRecords(20) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '기록 목록을 불러오지 못했습니다.';
    return Response.json({ error: message }, { status: 500 });
  }
}
