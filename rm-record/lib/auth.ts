import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'rm_record_session';

function accessKey() {
  return process.env.RM_RECORD_ACCESS_KEY ?? '';
}

function sessionToken() {
  const key = accessKey();
  if (!key) return '';
  return createHash('sha256').update(`rm-record:v1:${key}`).digest('hex');
}

export function verifyAccessKey(input: string) {
  const expected = accessKey();
  if (!expected || !input) return false;
  const a = Buffer.from(createHash('sha256').update(input).digest('hex'));
  const b = Buffer.from(createHash('sha256').update(expected).digest('hex'));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function isAuthorized() {
  const token = (await cookies()).get(COOKIE_NAME)?.value ?? '';
  const expected = sessionToken();
  if (!token || !expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function setSessionCookie() {
  (await cookies()).set(COOKIE_NAME, sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  (await cookies()).set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
