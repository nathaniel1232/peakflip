// Live multiplayer for the freeride mountain: a Supabase Realtime broadcast channel spoken directly over a
// WebSocket (Phoenix protocol), so there's no extra library and nothing stored in the database. Every rider
// sends a small position update a few times a second; riders nobody has heard from for a while disappear.
const SB = window.PEAKFLIP_CONFIG || {};

export function joinRoom(room, { onState, onLeave, onStatus }) {
  if (!SB.supabaseUrl || !SB.supabaseKey) { onStatus?.('offline'); return { send() {}, close() {}, count: () => 0 }; }
  const url = `${SB.supabaseUrl.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${SB.supabaseKey}&vsn=1.0.0`;
  const topic = `realtime:${room}`;
  let ws = null, ref = 0, joined = false, closed = false, beat = null, retry = 0;
  const seen = new Map();   // id → last time we heard from them
  const raw = (t, event, payload) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ topic: t, event, payload, ref: String(++ref) })); };

  function connect() {
    if (closed) return;
    onStatus?.('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => {
      raw(topic, 'phx_join', { config: { broadcast: { self: false }, presence: { key: '' } } });
      clearInterval(beat); beat = setInterval(() => raw('phoenix', 'heartbeat', {}), 25000);
    };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.topic !== topic) return;
      if (m.event === 'phx_reply' && m.payload?.status === 'ok' && !joined) { joined = true; retry = 0; onStatus?.('online'); }
      if (m.event === 'broadcast' && m.payload?.event === 'pos') {
        const s = m.payload.payload;
        if (!s || typeof s.id !== 'string') return;
        seen.set(s.id, performance.now()); onState(s);
      }
      if (m.event === 'broadcast' && m.payload?.event === 'bye') { const id = m.payload.payload?.id; seen.delete(id); onLeave(id); }
    };
    ws.onclose = () => {
      joined = false; clearInterval(beat);
      if (closed) return;
      onStatus?.('offline');
      setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));   // back off and try again
    };
  }
  connect();
  // forget riders that went quiet (closed the tab, lost connection)
  const sweep = setInterval(() => { const now = performance.now(); for (const [id, t] of seen) if (now - t > 5000) { seen.delete(id); onLeave(id); } }, 1000);

  return {
    send(state) { if (joined) raw(topic, 'broadcast', { type: 'broadcast', event: 'pos', payload: state }); },
    count: () => seen.size,
    close(id) {
      if (joined && id) raw(topic, 'broadcast', { type: 'broadcast', event: 'bye', payload: { id } });
      closed = true; clearInterval(beat); clearInterval(sweep);
      setTimeout(() => ws?.close(), 50);
    },
  };
}
