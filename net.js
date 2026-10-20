// Supabase RPC over plain fetch (leaderboards, ghosts, cloud saves). The browser can only call the
// validated functions in supabase/schema.sql; it has no direct table access.
const SB = window.PEAKFLIP_CONFIG || {};
export async function rpc(fn, args, keepalive = false) {
  if (!SB.supabaseUrl || !SB.supabaseKey) throw new Error('no backend');
  const r = await fetch(`${SB.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST', keepalive,
    headers: { apikey: SB.supabaseKey, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${fn} ${r.status}`);
  return r.json();
}
