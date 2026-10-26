import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedClock } from '../game-clock.js';

function ride(hz) {
  const clock = new FixedClock();
  let z = 0, speed = 22, vy = 11, y = 0, ticks = 0;
  for (let frame = 0; frame < hz * 10; frame++) clock.advance(1 / hz, dt => {
    ticks++;
    speed += (38 - speed) * dt;
    z -= speed * dt;
    vy -= 28 * dt;
    y = Math.max(0, y + vy * dt);
  });
  return { z, speed, vy, y, ticks };
}
test('identical simulation and race time at 30, 60, 144 and 165 Hz', () => {
  for (const hz of [30, 60, 144, 165]) assert.deepEqual(ride(hz), ride(60));
  assert.equal(ride(60).ticks, 600);
});
test('stalls and pause resets cannot produce a runaway simulation', () => {
  const clock = new FixedClock();
  let ticks = 0;
  clock.advance(90, () => ticks++);
  assert.equal(ticks, 6);
  clock.advance(1 / 120, () => ticks++);
  clock.reset();
  clock.advance(1 / 120, () => ticks++);
  assert.equal(ticks, 6);
  for (const invalid of [NaN, Infinity, -1, 0]) clock.advance(invalid, () => ticks++);
  assert.equal(ticks, 6);
});
