// Keep physics at the same cadence on 30, 60, 144 and 165 Hz displays.
// Drop long background stalls instead of fast-forwarding into an obstacle.
export class FixedClock {
  constructor(step = 1 / 60, maxFrame = 0.1) {
    this.step = step;
    this.maxFrame = maxFrame;
    this.pending = 0;
  }
  reset() { this.pending = 0; }
  advance(elapsed, simulate) {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return;
    this.pending += Math.min(elapsed, this.maxFrame);
    while (this.pending + 1e-10 >= this.step) {
      simulate(this.step);
      this.pending = Math.max(0, this.pending - this.step);
    }
  }
}
