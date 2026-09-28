// src/features/updates/__tests__/hostMaintenanceQueue.test.ts

import { hasPendingMaintenance, runExclusive } from '../hostMaintenanceQueue';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// A macrotask boundary: every microtask already queued (the queue's own
// promise links included) has run once this resolves.
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

// The queue is module state shared by every test in this file, so each test
// settles every operation it queues before it ends.
describe('runExclusive', () => {
  it('starts each operation only once the one queued before it has settled, in call order', async () => {
    const started: string[] = [];
    const first = defer<void>();
    const second = defer<void>();

    const runs = [
      runExclusive(async () => { started.push('first'); await first.promise; }),
      runExclusive(async () => { started.push('second'); await second.promise; }),
      runExclusive(async () => { started.push('third'); }),
    ];
    await flush();
    expect(started).toEqual(['first']);

    first.resolve();
    await flush();
    expect(started).toEqual(['first', 'second']);

    second.resolve();
    await Promise.all(runs);
    expect(started).toEqual(['first', 'second', 'third']);
  });

  it("hands each caller its own operation's result", async () => {
    await expect(runExclusive(async () => 'upgraded')).resolves.toBe('upgraded');
  });

  it('runs the next operation after one rejects, and hands that rejection to its own caller', async () => {
    const failing = runExclusive(async () => { throw new Error('dpkg was interrupted'); });
    const next = runExclusive(async () => 'ran');

    await expect(failing).rejects.toThrow('dpkg was interrupted');
    await expect(next).resolves.toBe('ran');
  });

  it('treats an operation that throws before returning a promise like one that rejects', async () => {
    const throwing = runExclusive((): Promise<void> => { throw new Error('bad argv'); });
    const next = runExclusive(async () => 'ran');

    await expect(throwing).rejects.toThrow('bad argv');
    await expect(next).resolves.toBe('ran');
  });
});

describe('hasPendingMaintenance', () => {
  it('reports maintenance while any operation is queued or running, and none once all have settled', async () => {
    expect(hasPendingMaintenance()).toBe(false);

    const first = defer<void>();
    const firstRun = runExclusive(() => first.promise);
    const failingRun = runExclusive(async () => { throw new Error('apt-get failed'); });
    expect(hasPendingMaintenance()).toBe(true);

    first.resolve();
    await firstRun;
    expect(hasPendingMaintenance()).toBe(true); // the failing one has yet to run

    await expect(failingRun).rejects.toThrow('apt-get failed');
    expect(hasPendingMaintenance()).toBe(false);
  });
});
