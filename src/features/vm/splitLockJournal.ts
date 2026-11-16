// src/features/vm/splitLockJournal.ts
//
// What KvmSplitLockMonitor reads from the kernel journal, and how.

export interface SplitLockEvent {
  timestamp: string;
  cpu: string;
  process: string;
  pid: string;
  address: string;
}

// The kernel journal is followed for split lock traps only. journalctl does the
// filtering (--grep, matched against the message): the kernel journal runs at
// info level on this host, ath10k noise included, and following all of it woke
// the agent for thousands of lines a day to keep almost none. -n 0 starts at the
// end, so a restart of the watcher does not count the last traps a second time;
// --output=cat prints the message alone, which is all the parser reads.
export const SPLIT_LOCK_JOURNAL_FOLLOW_ARGS = [
  '-k', '-f', '-n', '0', '--no-pager', '--output=cat', '--grep', 'took a split_lock trap',
];

// "x86/split lock detection: #AC: CPU 5/KVM/3495 took a split_lock trap at address: 0xfffff8040c6dfdff"
const SPLIT_LOCK_TRAP =
  /x86\/split lock detection: #AC: CPU (\d+)\/(.*?)\/(\d+) took a split_lock trap at address: (0x[0-9a-fA-F]+)/;

export function parseSplitLockMessage(message: string, now: Date = new Date()): SplitLockEvent | null {
  const match = message.match(SPLIT_LOCK_TRAP);
  if (!match) return null;
  return {
    timestamp: now.toISOString(),
    cpu: match[1],
    process: match[2],
    pid: match[3],
    address: match[4],
  };
}
