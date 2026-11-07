import type { Env } from '../env';

/** Same-origin by default. `ALLOWED_ORIGINS=*` or a comma list enables other apps. */
export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const wildcard = allowed.includes('*');
  if (!wildcard && !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': wildcard ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
