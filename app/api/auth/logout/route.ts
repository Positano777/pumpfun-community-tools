import { clearSessionCookie } from '@/lib/auth';
import { json, originAllowed } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout: clears the session cookie. */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  const res = json({ ok: true });
  res.headers.append('Set-Cookie', clearSessionCookie());
  return res;
}
