// ============================================================
//  Idiot, the Norwegian card game: the rules and the bots. Pure functions over a plain state object, so the
//  host (or the solo game) runs them and everyone else just draws the state they're sent.
//
//  One deck of 52, plus the two jokers if the table wants them. Each player gets 3 cards face down, 3 face up
//  on top of them and 3 in hand (the table can choose other counts), and may swap hand and face-up cards before
//  play. On your turn you play one or more cards of one rank, equal to or higher than the top of the pile
//  (aces high), then draw back up to the hand size while the deck lasts. A 2 goes on anything and resets the pile;
//  a 10 goes on anything and burns it; four of a rank in a row on the pile burns it too. After a burn you go
//  again. Can't play (or don't want to)? Pick up the whole pile, or try your luck with the top card of the
//  deck, whatever you hold. No building: once you have played and drawn, the turn passes. When the deck is empty
//  your last hand cards can take matching face-up cards with them. With your hand gone you play your face-up
//  cards, then the face-down ones blind. A joker goes on anything and is see-through: the next player has to
//  beat the card under it. The last player still holding cards is the Idiot.
// ============================================================

// a card is a number: (rank - 2) * 4 + suit for 0..51; 52 and 53 are the black and red joker
export const JOKER = 15;
export const rank = c => c >= 52 ? JOKER : (c >> 2) + 2;          // 2..14, ace high
export const suit = c => c >= 52 ? (c === 52 ? 3 : 2) : c & 3;    // 0 clubs, 1 diamonds, 2 hearts, 3 spades
export const live = slots => slots.filter(c => c != null);
const special = r => r === 2 || r === 10 || r === JOKER;
// how much a card is worth keeping: jokers, 10 and 2 above the ace
export const worth = r => r === JOKER ? 17 : r === 10 ? 16 : r === 2 ? 15 : r;

// what the table plays with: cards face down, face up and in hand, and whether the jokers are in
export const RULES = { down: 3, up: 3, hand: 3, jokers: false };
export function cleanRules(o = {}) {
  const n = (v, lo, hi, d) => Number.isInteger(v) && v >= lo && v <= hi ? v : d;
  return { down: n(o.down, 0, 4, 3), up: n(o.up, 1, 4, 3), hand: n(o.hand, 1, 5, 3), jokers: !!o.jokers };
}
export const deckSize = o => 52 + (o.jokers ? 2 : 0);
export const fits = (players, o) => players * (o.down + o.up + o.hand) <= deckSize(o);
export const sortHand = h => h.sort((a, b) => worth(rank(a)) - worth(rank(b)) || suit(a) - suit(b));

// the top card that counts: jokers are see-through
const topCard = pile => { for (let i = pile.length - 1; i >= 0; i--) if (rank(pile[i]) !== JOKER) return pile[i]; return null; };
// the rank you have to match or beat (0: anything goes)
export function need(pile) {
  const c = topCard(pile);
  if (c == null) return 0;
  const r = rank(c);
  return r === 2 ? 0 : r;
}
export const playable = (r, pile) => special(r) || r >= need(pile);

// how many cards of the top rank lie in a row on top of the pile (jokers in between don't break the row)
function topRun(pile) {
  const top = topCard(pile);
  if (top == null) return 0;
  let n = 0;
  for (let i = pile.length - 1; i >= 0; i--) {
    const r = rank(pile[i]);
    if (r === JOKER) continue;
    if (r !== rank(top)) break;
    n++;
  }
  return n;
}

// can a play of rank r from the hand also take your face-up cards of that rank? Only when the deck is empty and
// every card left in your hand is that rank, so the hand empties with it
export const withUp = (s, p, r) => !s.deck.length && p.hand.length > 0 && p.hand.every(c => rank(c) === r);

export function source(p) {
  return p.hand.length ? 'hand' : live(p.up).length ? 'up' : live(p.down).length ? 'down' : null;
}
const isOut = p => !source(p);

function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// seats: [{ id, name, bot }], 2 to 6 of them; every card comes from one deck, so the counts have to fit
export function deal(seats, rnd = Math.random, rules = RULES) {
  const o = cleanRules(rules);
  if (!fits(seats.length, o)) throw new Error('not enough cards');
  const deck = shuffle([...Array(deckSize(o)).keys()], rnd);
  const players = seats.map(s => ({
    id: s.id, name: s.name, bot: !!s.bot,
    down: deck.splice(0, o.down), up: deck.splice(0, o.up), hand: sortHand(deck.splice(0, o.hand)),
    ready: false, place: 0,
  }));
  return { phase: 'swap', rules: o, deck, pile: [], burned: 0, players, turn: -1, places: 0, ev: null, evN: 0 };
}

function event(s, ev) { s.ev = { ...ev, n: ++s.evN }; }

function nextPlayer(s, from) {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (!s.players[i].place) return i; }
  return from;
}

// the player holding the lowest card (2, 10 and jokers don't count) starts; seat order breaks ties
function starter(s) {
  let best = 0, bestV = 99;
  s.players.forEach((p, i) => {
    for (const c of p.hand) { const r = rank(c); if (!special(r) && r < bestV) { bestV = r; best = i; } }
  });
  return best;
}

function refill(s, p) {
  while (p.hand.length < (s.rules?.hand || 3) && s.deck.length) p.hand.push(s.deck.pop());
  sortHand(p.hand);
}

function pickUp(s, i, extra = []) {
  const p = s.players[i];
  p.hand.push(...s.pile, ...extra);
  sortHand(p.hand);
  const n = s.pile.length + extra.length;
  s.pile = [];
  s.turn = nextPlayer(s, i);
  return n;
}

// puts cards on the pile and settles what follows: drawing, burning, finishing, whose turn it is
function lay(s, i, cards, how) {
  const p = s.players[i];
  s.pile.push(...cards);
  refill(s, p);
  const r = rank(cards[0]);
  const burn = r === 10 || (r !== JOKER && topRun(s.pile) >= 4);
  event(s, { k: how, p: i, cards: [...cards], burn });
  if (burn) { s.burned += s.pile.length; s.pile = []; }
  if (isOut(p)) p.place = ++s.places;
  const left = s.players.filter(q => !q.place);
  if (left.length <= 1) {
    if (left[0]) left[0].place = s.players.length;   // the Idiot
    s.phase = 'over'; s.turn = -1;
    return;
  }
  s.turn = burn && !p.place ? i : nextPlayer(s, i);
}

// Applies one player's action. Returns an error string, or null when it was applied.
//   { t: 'swap', h: card in hand, u: slot 0-2 of a face-up card }   before play
//   { t: 'ready' }                                                   before play
//   { t: 'play', cards: [...] }    one rank, from the hand, or from the face-up cards once the hand is empty
//   { t: 'blind', i: slot }        a face-down card, once the hand and face-up cards are gone
//   { t: 'pickup' }                take the pile
//   { t: 'chance' }                turn over the top of the deck: play it if it fits, else take it with the pile
export function act(s, i, a) {
  const p = s.players[i];
  if (!p || !a) return 'bad';
  if (s.phase === 'swap') {
    if (p.ready) return 'ready';
    if (a.t === 'ready') {
      p.ready = true;
      if (s.players.every(q => q.ready)) { s.phase = 'play'; s.turn = starter(s); event(s, { k: 'start', p: s.turn }); }
      return null;
    }
    if (a.t === 'swap') {
      const h = p.hand.indexOf(a.h), u = a.u;
      if (h < 0 || !(u >= 0 && u < p.up.length) || p.up[u] == null) return 'bad';
      [p.hand[h], p.up[u]] = [p.up[u], p.hand[h]];
      sortHand(p.hand);
      return null;
    }
    return 'phase';
  }
  if (s.phase !== 'play') return 'phase';
  if (s.turn !== i) return 'turn';
  const from = source(p);

  if (a.t === 'play') {
    const cards = Array.isArray(a.cards) ? [...new Set(a.cards)] : [];
    if (!cards.length || (from !== 'hand' && from !== 'up')) return 'bad';
    const r = rank(cards[0]);
    if (cards.some(c => rank(c) !== r)) return 'rank';
    // your last hand cards can take matching face-up cards with them, once the deck is empty
    const pool = from === 'hand' && withUp(s, p, r) ? [...p.hand, ...live(p.up)] : from === 'hand' ? p.hand : p.up;
    if (cards.some(c => !pool.includes(c))) return 'bad';
    if (cards.some(c => p.up.includes(c)) && p.hand.some(c => !cards.includes(c))) return 'bad';
    if (!playable(r, s.pile)) return 'low';
    p.hand = p.hand.filter(c => !cards.includes(c));
    p.up = p.up.map(c => cards.includes(c) ? null : c);
    lay(s, i, cards, 'play');
    return null;
  }
  if (a.t === 'blind') {
    if (from !== 'down' || p.down[a.i] == null) return 'bad';
    const c = p.down[a.i];
    p.down[a.i] = null;
    if (playable(rank(c), s.pile)) { lay(s, i, [c], 'blind'); return null; }
    const n = pickUp(s, i, [c]);
    event(s, { k: 'blindMiss', p: i, cards: [c], n });
    return null;
  }
  if (a.t === 'pickup') {
    if (!s.pile.length) return 'empty';
    const n = pickUp(s, i);
    event(s, { k: 'pickup', p: i, n });
    return null;
  }
  if (a.t === 'chance') {
    if (!s.deck.length || from !== 'hand') return 'bad';
    const c = s.deck.pop();
    if (playable(rank(c), s.pile)) { lay(s, i, [c], 'chance'); return null; }
    const n = pickUp(s, i, [c]);
    event(s, { k: 'chanceMiss', p: i, cards: [c], n });
    return null;
  }
  return 'bad';
}

// ---------- bots ----------
// Before play: the best cards go face up. In play: get rid of the lowest rank that fits, all copies at
// once; keep 2s and 10s for when nothing else goes (a 10 when the pile is worth burning). Nothing fits: try
// the deck while it lasts, else pick up.
export function botMove(s, i, rnd = Math.random) {
  const p = s.players[i];
  if (s.phase === 'swap') {
    const up = live(p.up);
    const lowUp = up.reduce((a, c) => worth(rank(c)) < worth(rank(a)) ? c : a, up[0]);
    const highHand = p.hand.reduce((a, c) => worth(rank(c)) > worth(rank(a)) ? c : a, p.hand[0]);
    if (lowUp != null && highHand != null && worth(rank(highHand)) > worth(rank(lowUp))) return { t: 'swap', h: highHand, u: p.up.indexOf(lowUp) };
    return { t: 'ready' };
  }
  const from = source(p);
  if (from === 'down') {
    const slots = p.down.map((c, k) => c == null ? -1 : k).filter(k => k >= 0);
    return { t: 'blind', i: slots[Math.floor(rnd() * slots.length)] };
  }
  const pool = from === 'hand' ? p.hand : live(p.up);
  const byRank = new Map();
  for (const c of pool) { const r = rank(c); if (!byRank.has(r)) byRank.set(r, []); byRank.get(r).push(c); }
  const normal = [...byRank.keys()].filter(r => !special(r) && playable(r, s.pile)).sort((a, b) => a - b);
  if (normal.length) {
    const r = normal[0];
    return { t: 'play', cards: from === 'hand' && withUp(s, p, r) ? [...p.hand, ...live(p.up).filter(c => rank(c) === r)] : byRank.get(r) };
  }
  const ten = byRank.get(10), two = byRank.get(2), joker = byRank.get(JOKER);
  if (ten && (s.pile.length >= 4 || !two)) return { t: 'play', cards: [ten[0]] };
  if (two) return { t: 'play', cards: [two[0]] };
  if (ten) return { t: 'play', cards: [ten[0]] };
  if (joker) return { t: 'play', cards: [joker[0]] };
  if (from === 'hand' && s.deck.length) return { t: 'chance' };
  return { t: 'pickup' };
}
