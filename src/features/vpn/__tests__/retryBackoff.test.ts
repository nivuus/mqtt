import { RetryBackoff } from '../retryBackoff';

const S = 1000;

describe('RetryBackoff', () => {
  it('lets the first attempt through, then waits 15 s, 30 s, 60 s... capped at 5 min', () => {
    const b = new RetryBackoff();
    expect(b.due(0)).toBe(true);
    expect(b.nextAttempt()).toBeUndefined();
    const waits: number[] = [];
    let t = 0;
    for (let i = 0; i < 8; i++) {
      b.failed(t);
      waits.push((b.nextAttempt()! - t) / S);
      t = b.nextAttempt()!;
    }
    expect(waits).toEqual([15, 30, 60, 120, 240, 300, 300, 300]);
  });

  it('is not due before the next attempt, and due from then on', () => {
    const b = new RetryBackoff();
    b.failed(0);
    b.failed(15 * S); // next at 45 s
    expect(b.due(30 * S)).toBe(false);
    expect(b.due(45 * S)).toBe(true);
    expect(b.due(60 * S)).toBe(true);
  });

  it('a tick a few milliseconds early still counts as on time (ticks are periodic, not exact)', () => {
    const b = new RetryBackoff();
    b.failed(10 * S + 40); // the attempt started 40 ms into its tick
    expect(b.due(25 * S + 5)).toBe(true);
    expect(b.due(14 * S)).toBe(false);
  });

  it('reset starts over: due at once, first wait 15 s again', () => {
    const b = new RetryBackoff();
    for (let i = 0; i < 5; i++) b.failed(i);
    b.reset();
    expect(b.due(0)).toBe(true);
    expect(b.nextAttempt()).toBeUndefined();
    b.failed(0);
    expect(b.nextAttempt()).toBe(15 * S);
  });
});
