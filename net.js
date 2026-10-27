// Supabase RPC over plain fetch (leaderboards, ghosts, cloud saves). The browser can only call the
// validated functions in supabase/schema.sql; it has no direct table access.
const SB = window.PEAKFLIP_CONFIG || {};
export async function rpc(fn, args, keepalive = false, { timeoutMs = 12000 } = {}) {
  if (!SB.supabaseUrl || !SB.supabaseKey) throw new Error('no backend');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${SB.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST', keepalive, signal: ctl.signal,
      headers: { apikey: SB.supabaseKey, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`${fn} ${r.status}`);
    return await r.json(); // include a stalled response body in the deadline
  } finally {
    clearTimeout(timer);
  }
}
