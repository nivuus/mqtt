// src/mqtt/__tests__/mocks/unhandledRejections.ts
//
// Records the promise rejections nobody handled while `run` executes. The
// agent exits on the first one (Agent.setupSignalHandlers), so a feature that
// leaves a rejected promise behind takes the whole root agent down.

export async function unhandledRejectionsDuring(run: () => Promise<unknown>): Promise<unknown[]> {
  const reasons: unknown[] = [];
  const record = (reason: unknown) => { reasons.push(reason); };
  process.on('unhandledRejection', record);
  try {
    await run().catch(() => undefined); // a rejection of run() itself is handled
    // Node reports an unhandled rejection after the microtask queue drains.
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.removeListener('unhandledRejection', record);
  }
  return reasons;
}
