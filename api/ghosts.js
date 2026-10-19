import { hasDb, redis, validDay, boardKey } from './_db.js';

// GET ?day=YYYY-MM-DD&pid=...  →  the fastest few racers' ghosts for today's course (excluding you)
export default async function handler(req, res) {
  if (!hasDb()) return res.status(503).json({ error: 'leaderboard not configured' });
  const { day, pid = '' } = req.query;
  if (!validDay(day)) return res.status(400).json({ error: 'bad day' });
  const [flat] = await redis([['ZRANGE', boardKey('race', day), '0', '5', 'WITHSCORES']]);
  const ids = [];
  for (let i = 0; i < (flat || []).length; i += 2) if (flat[i] !== pid) ids.push(flat[i]);
  const pick = ids.slice(0, 3);
  if (!pick.length) return res.status(200).json({ ghosts: [] });
  const [names, ghosts] = await redis([['HMGET', 'pf:names', ...pick], ['MGET', ...pick.map(id => `pf:ghost:${day}:${id}`)]]);
  res.setHeader('cache-control', 'public, max-age=30');
  res.status(200).json({
    ghosts: pick.map((id, i) => ghosts[i] && { name: names[i] || 'Skier', ghost: JSON.parse(ghosts[i]) }).filter(Boolean),
  });
}
