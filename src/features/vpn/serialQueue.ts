/**
 * Runs async tasks one at a time, in submission order. The guest VPN's tick, switch commands
 * and profile imports all change NetworkManager and the DNS table, so they never interleave.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  /** Resolves or rejects with the task's own outcome; a failed task does not block the next. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    // The caller receives the rejection through `result`; the chain only needs to move on.
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Resolves once every task submitted so far has settled. */
  async idle(): Promise<void> {
    await this.tail;
  }
}
