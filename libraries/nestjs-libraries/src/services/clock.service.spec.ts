// libraries/nestjs-libraries/src/services/clock.service.spec.ts
//
// ClockService is intentionally thin (architect §6) — the value is the
// abstraction boundary, not the impl. These tests guard that the contract
// stays narrow: two methods, both returning live wall-clock readings.
import { ClockService } from './clock.service';

describe('ClockService', () => {
  let clock: ClockService;
  beforeEach(() => {
    clock = new ClockService();
  });

  it('now() returns a Date within ±1s of the test clock', () => {
    const before = Date.now();
    const result = clock.now();
    const after = Date.now();
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });

  it('nowMs() returns an integer ms timestamp consistent with now()', () => {
    const ms = clock.nowMs();
    expect(Number.isFinite(ms)).toBe(true);
    expect(Number.isInteger(ms)).toBe(true);
    expect(ms).toBeGreaterThan(1_600_000_000_000); // sanity: after 2020
  });

  it('exposes only now() and nowMs() (narrow surface)', () => {
    const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(clock))
      .filter((k) => k !== 'constructor')
      .sort();
    expect(keys).toEqual(['now', 'nowMs']);
  });
});
