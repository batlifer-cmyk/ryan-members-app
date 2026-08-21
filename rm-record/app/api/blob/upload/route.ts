import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { isAuthorized } from '@/lib/auth';

export async function POST(request: Request) {
  if (!(await isAuthorized())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith('rm-record/audio/')) {
          throw new Error('허용되지 않은 업로드 경로입니다.');
        }
        return {
          allowedContentTypes: [
            'audio/mpeg',
            'audio/mp3',
            'audio/mp4',
            'audio/x-m4a',
            'audio/m4a',
            'audio/wav',
            'audio/x-wav',
            'audio/webm',
            'audio/ogg',
            'video/mp4'
          ],
          maximumSizeInBytes: 100 * 1024 * 1024,
          addRandomSuffix: false,
        };
      },
      onUploadCompleted: async () => {},
    });

    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : '업로드 토큰 생성에 실패했습니다.';
    return Response.json({ error: message }, { status: 400 });
  }
}
