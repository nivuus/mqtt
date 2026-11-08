// src/features/ups/__tests__/batteryTestSchedule.test.ts

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PeriodicBatteryTest, batteryTestDecision, readLastRun, writeLastRun } from '../batteryTestSchedule';

const NOW = new Date('2026-11-08T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600 * 1000);

describe('batteryTestDecision', () => {
  it('is due when no test was ever recorded and the UPS is charged on mains', () => {
    expect(batteryTestDecision(null, NOW, 30, 'OL', 100).due).toBe(true);
  });

  it('accepts a charging UPS above the threshold', () => {
    expect(batteryTestDecision(null, NOW, 30, 'OL CHRG', 95).due).toBe(true);
  });

  it('waits until the interval has elapsed', () => {
    expect(batteryTestDecision(daysAgo(29), NOW, 30, 'OL', 100).due).toBe(false);
    expect(batteryTestDecision(daysAgo(30), NOW, 30, 'OL', 100).due).toBe(true);
  });

  it('never tests on battery, on low battery or with an unknown status', () => {
    expect(batteryTestDecision(null, NOW, 30, 'OB DISCHRG', 100).due).toBe(false);
    expect(batteryTestDecision(null, NOW, 30, 'OL LB', 100).due).toBe(false);
    expect(batteryTestDecision(null, NOW, 30, 'UNKNOWN', 100).due).toBe(false);
    expect(batteryTestDecision(null, NOW, 30, '', 100).due).toBe(false);
  });

  it('does not mistake a substring for the OL flag', () => {
    expect(batteryTestDecision(null, NOW, 30, 'BOLD', 100).due).toBe(false);
  });

  it('never tests a battery below 90 % or of unknown charge', () => {
    expect(batteryTestDecision(null, NOW, 30, 'OL', 89).due).toBe(false);
    expect(batteryTestDecision(null, NOW, 30, 'OL', null).due).toBe(false);
  });

  it('is off when the interval is 0', () => {
    expect(batteryTestDecision(null, NOW, 0, 'OL', 100).due).toBe(false);
  });
});

describe('state file', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ups-test-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads null when the file does not exist, and round-trips a date', () => {
    const file = path.join(dir, 'sub', 'last');
    expect(readLastRun(file)).toBeNull();
    writeLastRun(file, NOW);
    expect(readLastRun(file)?.toISOString()).toBe(NOW.toISOString());
  });

  it('refuses a corrupt file instead of reading it as "never tested"', () => {
    const file = path.join(dir, 'last');
    fs.writeFileSync(file, 'garbage\n');
    expect(() => readLastRun(file)).toThrow(/not a date/);
  });
});

describe('PeriodicBatteryTest', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ups-test-'));
    file = path.join(dir, 'last');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('starts a due test once and records it', async () => {
    const start = jest.fn().mockResolvedValue(true);
    const periodic = new PeriodicBatteryTest(file, 30, () => {});
    await periodic.tick(NOW, 'OL', 100, start);
    await periodic.tick(NOW, 'OL', 100, start);
    expect(start).toHaveBeenCalledTimes(1);
    expect(readLastRun(file)?.toISOString()).toBe(NOW.toISOString());
  });

  it('does not record a refused start and retries it a day later, not at the next poll', async () => {
    const start = jest.fn().mockResolvedValue(false);
    const periodic = new PeriodicBatteryTest(file, 30, () => {});
    await periodic.tick(NOW, 'OL', 100, start);
    await periodic.tick(new Date(NOW.getTime() + 15_000), 'OL', 100, start);
    expect(start).toHaveBeenCalledTimes(1);
    expect(readLastRun(file)).toBeNull();
    await periodic.tick(new Date(NOW.getTime() + 25 * 3600 * 1000), 'OL', 100, start);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('logs a postponement once, not at every poll', async () => {
    const log = jest.fn();
    const start = jest.fn();
    const periodic = new PeriodicBatteryTest(file, 30, log);
    await periodic.tick(NOW, 'OB DISCHRG', 100, start);
    await periodic.tick(NOW, 'OB DISCHRG', 100, start);
    expect(start).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });
});
