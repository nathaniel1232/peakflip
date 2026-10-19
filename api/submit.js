import { hasDb, redis, validDay, boardKey } from './_db.js';

// POST { board: 'endless'|'race', day?: 'YYYY-MM-DD', value: number, pid: string, name: string }
// ghost = { t, f: [x,y,z,rx,ry,rz, ...] as ints ×100 sampled at 10 Hz }
function validGhost(g, time) {
  return g && Array.isArray(g.f) && g.f.length >= 60 && g.f.length <= 6 * 10 * 900 && g.f.length % 6 === 0
    && g.f.every(n => Number.isInteger(n) && Math.abs(n) < 1e7) && Math.abs(Number(g.t) - time) < 0.05;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!hasDb()) return res.status(503).json({ error: 'leaderboard not configured' });
  const { board, day, value, pid, name, ghost } = req.body || {};
  if (!['endless', 'race'].includes(board)) return res.status(400).json({ error: 'bad board' });
  if (typeof pid !== 'string' || !/^[\w-]{8,64}$/.test(pid)) return res.status(400).json({ error: 'bad pid' });
  const clean = String(name || '').replace(/[^\p{L}\p{N} _.\-!]/gu, '').trim().slice(0, 14);
  if (!clean) return res.status(400).json({ error: 'bad name' });
  const v = Number(value);
  // basic sanity limits (this is a casual game — not cheat-proof)
  if (board === 'endless' && !(v >= 0 && v <= 3_000_000)) return res.status(400).json({ error: 'bad value' });
  if (board === 'race' && !(v >= 25 && v <= 900)) return res.status(400).json({ error: 'bad value' });
  if (board === 'race' && !validDay(day)) return res.status(400).json({ error: 'bad day' });

  const key = boardKey(board, day);
  const [allowed] = await redis([['SET', `pf:rl:${pid}`, '1', 'NX', 'PX', '1500']]);
  if (allowed !== 'OK') return res.status(429).json({ error: 'slow down' });
  const [, changed] = await redis([
    ['HSET', 'pf:names', pid, clean],
    ['ZADD', key, board === 'race' ? 'LT' : 'GT', 'CH', String(v), pid],
    ...(board === 'race' ? [['EXPIRE', key, String(60 * 60 * 24 * 14)]] : []),
  ]);
  // race ghost: stored when it's this player's best (or their first ghost today)
  if (board === 'race' && validGhost(ghost, v)) {
    const gk = `pf:ghost:${day}:${pid}`;
    const [exists] = await redis([['EXISTS', gk]]);
    if (changed || !exists) await redis([['SET', gk, JSON.stringify({ t: v, f: ghost.f }), 'EX', String(60 * 60 * 24 * 3)]]);
  }
  res.status(200).json({ ok: true });
}
