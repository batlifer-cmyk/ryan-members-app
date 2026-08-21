import { NextResponse } from 'next/server';
import { clearSessionCookie, isAuthorized, setSessionCookie, verifyAccessKey } from '@/lib/auth';

export async function GET() {
  return NextResponse.json({ authenticated: await isAuthorized() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { accessKey?: string };
  if (!verifyAccessKey(body.accessKey ?? '')) {
    return NextResponse.json({ error: '접근키가 올바르지 않습니다.' }, { status: 401 });
  }
  await setSessionCookie();
  return NextResponse.json({ authenticated: true });
}

export async function DELETE() {
  await clearSessionCookie();
  return NextResponse.json({ authenticated: false });
}
