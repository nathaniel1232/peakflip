// Tiny Upstash Redis REST client (no dependencies).
// Vercel sets these env vars automatically when you connect an Upstash Redis store to the project.
const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const hasDb = () => Boolean(URL && TOKEN);

export async function redis(commands) {
  const r = await fetch(`${URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).map(x => x.result);
}

export const utcDay = (offset = 0) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
export const validDay = d => d === utcDay() || d === utcDay(-1) || d === utcDay(1);
export const boardKey = (board, day) => (board === 'race' ? `pf:race:${day}` : 'pf:endless');
