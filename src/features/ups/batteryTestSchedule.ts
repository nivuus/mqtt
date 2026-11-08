// src/features/ups/batteryTestSchedule.ts
//
// When the UPS may run its periodic quick battery test.
//
// Nothing else exercises the battery: a UPS that sits on mains for months
// reports 100 % right up to the outage where it lasts 30 seconds. A quick
// test (about 10 s on battery) is what makes `ups.test.result` mean
// something, and it is only safe when the battery has charge to spare and
// the mains is present, so those are checked here, not assumed.

import * as fs from 'fs';
import * as path from 'path';

const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_CHARGE_FOR_TEST = 90;

export interface TestDecision {
  due: boolean;
  reason: string;
}

export function batteryTestDecision(
  lastRun: Date | null,
  now: Date,
  intervalDays: number,
  status: string,
  charge: number | null,
): TestDecision {
  if (!(intervalDays > 0)) return { due: false, reason: 'periodic test disabled' };
  if (lastRun && now.getTime() - lastRun.getTime() < intervalDays * DAY_MS) {
    return { due: false, reason: `last test on ${lastRun.toISOString()}` };
  }
  const flags = status.split(/\s+/);
  if (!flags.includes('OL') || flags.includes('OB') || flags.includes('LB')) {
    return { due: false, reason: `mains not established (status ${status || 'unknown'})` };
  }
  if (charge === null || charge < MIN_CHARGE_FOR_TEST) {
    return { due: false, reason: `battery at ${charge ?? 'unknown'} %, below ${MIN_CHARGE_FOR_TEST} %` };
  }
  return { due: true, reason: 'due' };
}

/** The date of the last periodic test, or null when none was ever recorded. */
export function readLastRun(file: string): Date | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8').trim();
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`${file}: not a date: ${JSON.stringify(text)}`);
  return date;
}

export function writeLastRun(file: string, when: Date): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${when.toISOString()}\n`);
  fs.renameSync(tmp, file);
}

/** A failed start (upsd down, command refused) is retried after this delay, not at every poll. */
export const RETRY_AFTER_FAILURE_MS = DAY_MS;

/**
 * Runs the quick test when batteryTestDecision says it is due, and records
 * the run in `stateFile` so the interval survives agent restarts and package
 * upgrades. Only a test the UPS accepted is recorded: a refused start must
 * stay due, but is retried once a day rather than at every 15 s poll.
 */
export class PeriodicBatteryTest {
  private lastFailure: number | null = null;
  private lastReason = '';

  constructor(
    private readonly stateFile: string,
    private readonly intervalDays: number,
    private readonly log: (msg: string) => void,
  ) {}

  lastRun(): Date | null {
    return readLastRun(this.stateFile);
  }

  async tick(now: Date, status: string, charge: number | null, start: () => Promise<boolean>): Promise<void> {
    if (this.lastFailure !== null && now.getTime() - this.lastFailure < RETRY_AFTER_FAILURE_MS) return;
    const decision = batteryTestDecision(this.lastRun(), now, this.intervalDays, status, charge);
    if (!decision.due) {
      // An overdue test held back by the UPS state is worth one log line, not one per poll.
      if (decision.reason !== this.lastReason && !decision.reason.startsWith('last test on')
          && decision.reason !== 'periodic test disabled') {
        this.log(`periodic battery test postponed: ${decision.reason}`);
      }
      this.lastReason = decision.reason;
      return;
    }
    this.lastReason = '';
    this.log('periodic battery test due, starting it');
    if (await start()) {
      writeLastRun(this.stateFile, now);
      this.lastFailure = null;
    } else {
      this.lastFailure = now.getTime();
    }
  }
}
