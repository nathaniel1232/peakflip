import { hasDb, redis, validDay, boardKey } from './_db.js';

// GET ?board=endless|race&day=YYYY-MM-DD&pid=...
export default async function handler(req, res) {
  if (!hasDb()) return res.status(503).json({ error: 'leaderboard not configured' });
  const { board = 'endless', day, pid = '' } = req.query;
  if (!['endless', 'race'].includes(board)) return res.status(400).json({ error: 'bad board' });
  if (board === 'race' && !validDay(day)) return res.status(400).json({ error: 'bad day' });
  const key = boardKey(board, day);
  const asc = board === 'race';
  const [flat, rank, score] = await redis([
    asc ? ['ZRANGE', key, '0', '19', 'WITHSCORES'] : ['ZRANGE', key, '0', '19', 'REV', 'WITHSCORES'],
    [asc ? 'ZRANK' : 'ZREVRANK', key, String(pid)],
    ['ZSCORE', key, String(pid)],
  ]);
  const ids = [], vals = [];
  for (let i = 0; i < (flat || []).length; i += 2) { ids.push(flat[i]); vals.push(Number(flat[i + 1])); }
  const names = ids.length ? (await redis([['HMGET', 'pf:names', ...ids]]))[0] : [];
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({
    top: ids.map((id, i) => ({ name: names[i] || 'Skier', value: vals[i], isMe: id === pid })),
    me: rank === null || rank === undefined ? null : { rank: rank + 1, value: Number(score) },
  });
}
