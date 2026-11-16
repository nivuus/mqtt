// src/features/vm/__tests__/KvmSplitLockMonitor.journal.test.ts
//
// The split lock watcher follows the kernel journal. journalctl must do the
// filtering (the kernel journal is chatty at info level), start at the end
// (a watcher restart must not count old traps again), and a trap line split
// across two pipe chunks must still be read.

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'child_process';
import { KvmSplitLockMonitor } from '../KvmSplitLockMonitor';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import logger from '../../../utils/logger';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
const mockedSpawn = spawn as unknown as jest.Mock;

jest.mock('../../../config', () => ({
  getConfigManager: jest.fn(() => ({
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Test', identifiers: ['nivuus'], manufacturer: 'T', model: 'A', sw_version: '1' },
      features: { kvm_split_lock_monitor: { enabled: true } },
    },
  })),
}));

class FakeJournal extends EventEmitter {
  public stdout = new PassThrough();
  public stderr = new PassThrough();
  public kill = jest.fn();
}

const TRAP = 'x86/split lock detection: #AC: CPU 5/KVM/3495 took a split_lock trap at address: 0xfffff8040c6dfdff';

let journal: FakeJournal;

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {});
  }
  journal = new FakeJournal();
  mockedSpawn.mockReturnValue(journal);
});

afterEach(() => jest.restoreAllMocks());

const setupOf = (feature: KvmSplitLockMonitor) =>
  (feature as unknown as { setup: () => Promise<void> }).setup();
const cleanupOf = (feature: KvmSplitLockMonitor) =>
  (feature as unknown as { cleanup: () => Promise<void> }).cleanup();

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe('KvmSplitLockMonitor journal watcher', () => {
  it('asks journalctl for new split lock lines only', async () => {
    const client = new MockMqttClient();
    await client.connect();
    const feature = new KvmSplitLockMonitor(client, 'kvm_split_lock_monitor');
    await setupOf(feature);

    const [command, args] = mockedSpawn.mock.calls[0];
    expect(command).toBe('journalctl');
    expect(args).toEqual(expect.arrayContaining(['-k', '-f', '--grep']));
    expect(args[args.indexOf('--grep') + 1]).toBe('took a split_lock trap');
    expect(args[args.indexOf('-n') + 1]).toBe('0');
    await cleanupOf(feature);
  });

  it('reads a trap line that arrives in two chunks', async () => {
    const client = new MockMqttClient();
    await client.connect();
    const feature = new KvmSplitLockMonitor(client, 'kvm_split_lock_monitor');
    await setupOf(feature);

    journal.stdout.write(TRAP.slice(0, 40));
    await settle();
    journal.stdout.write(`${TRAP.slice(40)}\n`);
    await settle();

    const count = client.publishedMessages.filter((m) => m.topic.endsWith('kvm_split_lock_monitor/count/state'));
    expect(count.map((m) => String(m.message))).toEqual(['1']);
    const alert = client.publishedMessages.find((m) => m.topic === 'system_agent/nivuus/alert');
    expect(JSON.parse(String(alert?.message)).data).toEqual({ cpu: '5', process: 'KVM', pid: '3495', address: '0xfffff8040c6dfdff' });
    await cleanupOf(feature);
  });
});
