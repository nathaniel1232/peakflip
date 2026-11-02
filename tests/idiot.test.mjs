import test from 'node:test';
import assert from 'node:assert/strict';
import { deal, act, botMove, rank, live, need, source } from '../idiot-rules.js';

const C = (r, s = 0, copy = 0) => copy * 52 + (r - 2) * 4 + s;
const seats = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, bot: true }));
function seeded(seed) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
const count = s => s.deck.length + s.pile.length + s.burned + s.players.reduce((n, p) => n + p.hand.length + live(p.up).length + live(p.down).length, 0);

// a game in play with hands set by the test
function table(hands, { pile = [], deck = [] } = {}) {
  const s = deal(seats(hands.length));
  s.phase = 'play'; s.turn = 0; s.deck = deck; s.pile = pile; s.burned = 0;
  s.players.forEach((p, i) => { p.hand = hands[i]; p.up = [C(5, 1, 1), C(6, 1, 1), C(7, 1, 1)]; p.down = [C(8, 1, 1), C(9, 1, 1), C(11, 1, 1)]; });
  return s;
}

test('deals 3 down, 3 up and 3 in hand; six players share two decks', () => {
  const s = deal(seats(4));
  for (const p of s.players) assert.deepEqual([p.down.length, p.up.length, p.hand.length], [3, 3, 3]);
  assert.equal(count(s), 52);
  assert.equal(count(deal(seats(6))), 104);
  assert.equal(new Set(deal(seats(5)).deck).size, 52 - 45);
});

test('play must match or beat the top card; 2 resets it and 10 goes on anything', () => {
  const s = table([[C(5), C(9)], [C(3), C(2), C(4)]], { pile: [C(8)] });
  assert.equal(act(s, 0, { t: 'play', cards: [C(5)] }), 'low');
  assert.equal(act(s, 1, { t: 'play', cards: [C(3)] }), 'turn');
  assert.equal(act(s, 0, { t: 'play', cards: [C(9)] }), null);
  assert.equal(s.turn, 1);
  assert.equal(act(s, 1, { t: 'play', cards: [C(2)] }), null);
  assert.equal(need(s.pile), 0);
  assert.equal(act(s, 0, { t: 'play', cards: [C(5)] }), null);
});

test('a 10 burns the pile and the same player goes again', () => {
  const s = table([[C(10), C(4)], [C(3)]], { pile: [C(14), C(13)] });
  assert.equal(act(s, 0, { t: 'play', cards: [C(10)] }), null);
  assert.deepEqual(s.pile, []);
  assert.equal(s.burned, 3);
  assert.equal(s.turn, 0);
  assert.ok(s.ev.burn);
});

test('four of a rank in a row burns, across players too', () => {
  const s = table([[C(7, 0), C(7, 1), C(3)], [C(7, 2), C(7, 3), C(4)]], { pile: [C(6)] });
  assert.equal(act(s, 0, { t: 'play', cards: [C(7, 0), C(7, 1)] }), null);
  assert.equal(s.turn, 1);
  assert.equal(act(s, 1, { t: 'play', cards: [C(7, 2), C(7, 3)] }), null);
  assert.deepEqual(s.pile, []);
  assert.equal(s.turn, 1);
});

test('mixed ranks and cards you do not hold are refused', () => {
  const s = table([[C(5), C(6)], [C(3)]]);
  assert.equal(act(s, 0, { t: 'play', cards: [C(5), C(6)] }), 'rank');
  assert.equal(act(s, 0, { t: 'play', cards: [C(9, 2)] }), 'bad');
  assert.equal(act(s, 0, { t: 'play', cards: [C(5, 1, 1)] }), 'bad');   // face-up while the hand has cards
});

test('picking up takes the whole pile and passes the turn', () => {
  const s = table([[C(3)], [C(4)]], { pile: [C(9), C(12)] });
  assert.equal(act(s, 0, { t: 'pickup' }), null);
  assert.equal(s.players[0].hand.length, 3);
  assert.equal(s.turn, 1);
  assert.equal(act(s, 1, { t: 'pickup' }), 'empty');
});

test('players draw back up to three while the deck lasts', () => {
  const s = table([[C(3), C(4), C(5)], [C(6)]], { deck: [C(12), C(13)] });
  act(s, 0, { t: 'play', cards: [C(3)] });
  assert.equal(s.players[0].hand.length, 3);
  assert.equal(s.deck.length, 1);
});

test('trying the deck plays the card when it fits, and picks up the pile with it when not', () => {
  const s = table([[C(3), C(3, 1), C(3, 2)], [C(4)]], { pile: [C(9)], deck: [C(4, 2), C(12, 2)] });
  assert.equal(act(s, 0, { t: 'chance' }), null);   // queen fits on 9
  assert.equal(rank(s.pile.at(-1)), 12);
  assert.equal(s.turn, 1);
  assert.equal(act(s, 1, { t: 'chance' }), null);   // 4 on a queen doesn't
  assert.deepEqual(s.pile, []);
  assert.deepEqual(s.players[1].hand.map(rank), [4, 4, 9, 12]);
  assert.equal(s.ev.k, 'chanceMiss');
});

test('face-up cards come after the hand, face-down ones blind after that', () => {
  const s = table([[], [C(3)]], { pile: [C(6)] });
  assert.equal(source(s.players[0]), 'up');
  assert.equal(act(s, 0, { t: 'blind', i: 0 }), 'bad');
  assert.equal(act(s, 0, { t: 'play', cards: [C(7, 1, 1)] }), null);
  s.players[0].up = [null, null, null]; s.turn = 0; s.pile = [C(13)];
  assert.equal(source(s.players[0]), 'down');
  assert.equal(act(s, 0, { t: 'blind', i: 0 }), null);   // an 8 on a king: picked up with the pile
  assert.equal(s.ev.k, 'blindMiss');
  assert.deepEqual(s.players[0].hand.map(rank), [8, 13]);
  assert.equal(s.turn, 1);
});

test('with the deck empty, the last hand cards take matching face-up cards with them', () => {
  const s = table([[C(6, 0), C(6, 2)], [C(3)]], { pile: [C(5)] });
  s.players[0].up = [C(6, 3), C(9, 1), null];
  assert.equal(act(s, 0, { t: 'play', cards: [C(6, 0), C(6, 2), C(6, 3)] }), null);
  assert.deepEqual(s.players[0].hand, []);
  assert.deepEqual(s.players[0].up, [null, C(9, 1), null]);
  assert.equal(s.turn, 1);
});

test('face-up cards stay put while the hand keeps other cards or the deck still has cards', () => {
  const s = table([[C(6, 0), C(8)], [C(3)]], { pile: [C(5)] });
  s.players[0].up = [C(6, 3), null, null];
  assert.equal(act(s, 0, { t: 'play', cards: [C(6, 0), C(6, 3)] }), 'bad');
  const t = table([[C(6, 0)], [C(3)]], { pile: [C(5)], deck: [C(12)] });
  t.players[0].up = [C(6, 3), null, null];
  assert.equal(act(t, 0, { t: 'play', cards: [C(6, 0), C(6, 3)] }), 'bad');
});

test('you may try the deck even with playable cards in hand', () => {
  const s = table([[C(14), C(13), C(12)], [C(3)]], { pile: [C(4)], deck: [C(9)] });
  assert.equal(act(s, 0, { t: 'chance' }), null);
  assert.equal(rank(s.pile.at(-1)), 9);
});

test('the last player holding cards is the Idiot', () => {
  const s = table([[C(9)], [C(3)], [C(4)]]);
  for (const p of s.players) { p.up = [null, null, null]; p.down = [null, null, null]; }
  assert.equal(act(s, 0, { t: 'play', cards: [C(9)] }), null);
  assert.equal(s.players[0].place, 1);
  assert.equal(act(s, 1, { t: 'pickup' }), null);
  assert.equal(act(s, 2, { t: 'play', cards: [C(4)] }), null);
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.players.map(p => p.place), [1, 3, 2]);
});

test('swapping before play, and the lowest card starts', () => {
  const s = deal(seats(2), seeded(3));
  const p = s.players[0], h = p.hand[0], u = p.up[1];
  assert.equal(act(s, 0, { t: 'swap', h, u: 1 }), null);
  assert.ok(p.hand.includes(u) && p.up[1] === h);
  assert.equal(act(s, 0, { t: 'play', cards: [p.hand[0]] }), 'phase');
  act(s, 0, { t: 'ready' });
  assert.equal(act(s, 0, { t: 'swap', h: p.hand[0], u: 0 }), 'ready');
  act(s, 1, { t: 'ready' });
  assert.equal(s.phase, 'play');
  const low = pl => Math.min(99, ...pl.hand.map(rank).filter(r => r !== 2 && r !== 10));
  assert.ok(low(s.players[s.turn]) <= low(s.players[1 - s.turn]));
});

test('bots finish thousands of games with every card accounted for and one Idiot', () => {
  for (let g = 0; g < 3000; g++) {
    const rnd = seeded(g + 1), n = 2 + (g % 5);
    const s = deal(seats(n), rnd), total = count(s);
    let moves = 0;
    while (s.phase !== 'over') {
      const i = s.phase === 'swap' ? s.players.findIndex(p => !p.ready) : s.turn;
      const a = botMove(s, i, rnd);
      assert.equal(act(s, i, a), null, `game ${g}: ${JSON.stringify(a)} refused`);
      assert.equal(count(s), total);
      assert.ok(++moves < 5000, `game ${g} never ended`);
    }
    const places = s.players.map(p => p.place).sort((a, b) => a - b);
    assert.deepEqual(places, Array.from({ length: n }, (_, i) => i + 1));
  }
});
