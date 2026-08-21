import { isAuthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await isAuthorized())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    accessKey: Boolean(process.env.RM_RECORD_ACCESS_KEY),
  };

  return Response.json({
    ok: Object.values(config).every(Boolean),
    config,
    service: 'rm-record',
    version: '1.0.0',
  });
}
