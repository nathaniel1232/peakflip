// ============================================================
//  Word filter for player-written text (chat messages and names). Bad words are masked with ***
//  wherever they're shown, and refused when someone tries to send one. CrazyGames requires this for
//  any game with chat. Not a complete list; add to WORDS when something slips through.
// ============================================================
const WORDS = [
  'fuck', 'fuk', 'fck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'bastard',
  'asshole', 'arsehole', 'wanker', 'twat', 'prick', 'bollocks', 'motherfucker', 'dildo', 'porn', 'penis',
  'vagina', 'boob', 'tits', 'cum', 'jizz', 'rape', 'rapist', 'nazi', 'hitler', 'kys', 'nigger', 'nigga',
  'faggot', 'fag', 'retard', 'spic', 'chink', 'kike', 'tranny', 'paki', 'coon', 'gook', 'wetback',
  // Norwegian, since a lot of the players are
  'faen', 'fitte', 'kuk', 'hore', 'jævla', 'jævel', 'helvete', 'neger', 'pikk', 'ræva',
];
// these count even inside another word (clusterfuck, bullshit)
const ANYWHERE = new Set(['fuck', 'shit', 'nigger', 'faggot']);
// endings a short word may carry and still count (shits, fucking, dickhead); anything else is a different word (cockpit, Dickens)
const ENDING = /^(s|es|ed|er|ers|ing|in|ty|ted|ter|head|heads|face|hole|holes)?$/;
// letters people swap in to dodge filters (sh1t, $hit); always one character for one, so positions line up
const LOOK = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };
const fold = s => [...s].map(c => { const l = c.toLowerCase(); return LOOK[l] ?? (l.length === c.length ? l : c); }).join('');
const LETTER = /[\p{L}]/u;
// repeats and dots between letters still match (fuuuck, f.u.c.k)
const RES = WORDS.map(w => ({ w, re: new RegExp([...w].map(c => c + '+').join('[\\W_]*'), 'gu') }));

function hits(text) {
  const s = fold(String(text)), spans = [];
  for (const { w, re } of RES) for (const m of s.matchAll(re)) {
    const start = m.index, end = start + m[0].length;
    if (!ANYWHERE.has(w)) {
      if (LETTER.test(s[start - 1] || '')) continue;   // "therapist", "grape", "raccoon"
      if (!ENDING.test(s.slice(end).match(/^\p{L}*/u)[0])) continue;
    }
    spans.push([start, end]);
  }
  return spans.sort((a, b) => a[0] - b[0]);
}

export const isClean = text => !hits(text).length;
// the same text with every bad word replaced by asterisks
export function clean(text) {
  const s = String(text), spans = hits(s);
  if (!spans.length) return s;
  let out = '', at = 0;
  for (const [a, b] of spans) { if (b <= at) continue; out += s.slice(at, Math.max(a, at)) + '*'.repeat(b - Math.max(a, at)); at = b; }
  return out + s.slice(at);
}
