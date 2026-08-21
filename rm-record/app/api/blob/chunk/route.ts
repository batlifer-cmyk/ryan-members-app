import { del, list, put } from '@vercel/blob';
import { isAuthorized } from '@/lib/auth';

export const runtime = 'nodejs';

const MAX_CHUNK_BYTES = 3 * 1024 * 1024;
const UPLOAD_ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;

function prefixFor(uploadId: string) {
  return `rm-record/tmp/${uploadId}/`;
}

export async function POST(request: Request) {
  if (!(await isAuthorized())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const uploadId = url.searchParams.get('uploadId') ?? '';
  const index = Number(url.searchParams.get('index'));

  if (!UPLOAD_ID_RE.test(uploadId) || !Number.isInteger(index) || index < 0 || index > 999) {
    return Response.json({ error: '잘못된 업로드 정보입니다.' }, { status: 400 });
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_CHUNK_BYTES) {
    return Response.json({ error: '업로드 조각이 너무 큽니다.' }, { status: 413 });
  }

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_CHUNK_BYTES) {
    return Response.json({ error: '업로드 조각 크기가 올바르지 않습니다.' }, { status: 400 });
  }

  try {
    const blob = await put(`${prefixFor(uploadId)}${String(index).padStart(4, '0')}.part`, bytes, {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/octet-stream',
    });

    return Response.json({
      chunk: {
        url: blob.url,
        pathname: blob.pathname,
        index,
        size: bytes.byteLength,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '업로드에 실패했습니다.';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAuthorized())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { uploadId?: string };
  const uploadId = body.uploadId ?? '';
  if (!UPLOAD_ID_RE.test(uploadId)) {
    return Response.json({ error: '잘못된 업로드 정보입니다.' }, { status: 400 });
  }

  try {
    const found = await list({ prefix: prefixFor(uploadId), limit: 1000 });
    if (found.blobs.length) {
      await del(found.blobs.map((blob) => blob.url));
    }
    return Response.json({ deleted: found.blobs.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : '임시 파일 삭제에 실패했습니다.';
    return Response.json({ error: message }, { status: 500 });
  }
}
