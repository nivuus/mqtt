// src/features/disk/__tests__/SmartStatus.update.test.ts
//
// What SmartStatus publishes for a SATA disk, an NVMe disk and the Windows
// VM's disks read over WinRM, from smartctl's JSON.

import { SmartStatus } from '../SmartStatus';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import { execute_argv } from '../../../utils/exec';
import { getNativeDiskIOStats } from '../../../utils/diskStats';
import { isWindowsVmRunning } from '../../../utils/vmState';
import logger from '../../../utils/logger';

jest.mock('../../../utils/exec', () => ({ execute_argv: jest.fn() }));
jest.mock('../../../utils/diskStats', () => ({ getNativeDiskIOStats: jest.fn() }));
jest.mock('../../../utils/vmState', () => ({ isWindowsVmRunning: jest.fn() }));
const remoteCommand = jest.fn();
jest.mock('../../../utils/winrm', () => ({ createWinRMClient: () => ({ executeCommand: remoteCommand }) }));

const REMOTE_DISKS = [
  { name: 'Bureau 日本', device: '/dev/sda', friendly_name: 'Bureau 日本' },
  { name: 'Bureau 中国', device: '/dev/sdb', friendly_name: 'Bureau 中国' },
];
jest.mock('../../../config', () => ({
  getConfigManager: jest.fn(() => ({
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Test', identifiers: ['nivuus'], manufacturer: 'T', model: 'A', sw_version: '1' },
      features: {
        smart_status: {
          enabled: true, update_interval_seconds: 10, disks_to_monitor: ['sda', 'nvme0n1'], remote_disks: REMOTE_DISKS,
        },
      },
    },
  })),
}));

const SATA_JSON = {
  smart_status: { passed: true },
  ata_smart_attributes: {
    table: [
      { id: 5, name: 'Reallocated_Sector_Ct', value: 100, worst: 100, thresh: 10, when_failed: '', flags: { prefailure: true }, raw: { value: 0, string: '0' } },
      { id: 241, name: 'Total_LBAs_Written', value: 100, worst: 100, thresh: 0, when_failed: '', flags: { old_age: true }, raw: { value: 2097152, string: '2097152' } },
    ],
  },
};
const NVME_JSON = {
  smart_status: { passed: false },
  device: { type: 'nvme' },
  nvme_smart_health_information_log: { critical_warning: 0, media_errors: 2, data_units_read: 2048, data_units_written: 4096 },
};

const mockedExec = execute_argv as jest.MockedFunction<typeof execute_argv>;

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {});
  }
  mockedExec.mockImplementation(async (_file, args) => {
    const device = args[args.length - 1];
    const json = device === '/dev/sda' ? SATA_JSON : NVME_JSON;
    return { stdout: JSON.stringify(json), stderr: '', exitCode: 0 };
  });
  (getNativeDiskIOStats as jest.Mock).mockResolvedValue([
    { device: 'sda', rIO: 1000, wIO: 2000 },
  ]);
  (isWindowsVmRunning as jest.Mock).mockResolvedValue(true);
  remoteCommand.mockResolvedValue(JSON.stringify(SATA_JSON));
});

afterEach(() => jest.restoreAllMocks());

const updateOf = (feature: SmartStatus) => (feature as unknown as { update: () => Promise<void> }).update();

function published(client: MockMqttClient): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of client.publishedMessages) out[m.topic] = String(m.message);
  return out;
}

describe('SmartStatus.update', () => {
  it('publishes health, attributes, data written and read for local disks', async () => {
    const client = new MockMqttClient();
    await client.connect();
    await updateOf(new SmartStatus(client, 'smart_status'));
    const states = published(client);
    const base = 'system_agent/nivuus/smart_status';

    expect(states[`${base}/sda/health/state`]).toBe('PASSED');
    expect(states[`${base}/sda/lbas_written/state`]).toBe('1.00');
    expect(JSON.parse(states[`${base}/sda/attributes`]).smart_attributes).toEqual([
      { id: 5, name: 'Reallocated_Sector_Ct', value: 100, raw: '0', failed: false },
      { id: 241, name: 'Total_LBAs_Written', value: 100, raw: '2097152', failed: false },
    ]);
    // First sample: no previous counters, so no speed yet.
    expect(states[`${base}/sda/read_speed/state`]).toBe('0.00');

    expect(states[`${base}/nvme0n1/health/state`]).toBe('FAILED');
    expect(states[`${base}/nvme0n1/lbas_written/state`]).toBe('1.95');
    expect(states[`${base}/nvme0n1/lbas_read/state`]).toBe('0.98');
    const nvmeAttributes = JSON.parse(states[`${base}/nvme0n1/attributes`]).smart_attributes;
    expect(nvmeAttributes).toContainEqual({ id: 0, name: 'media_data_integrity_errors', value: 2, raw: '2', failed: true });
    expect(nvmeAttributes).toContainEqual({ id: 0, name: 'critical_warning', value: 0, raw: '0', failed: false });
  });

  it('computes read and write speeds from the previous sample', async () => {
    const client = new MockMqttClient();
    await client.connect();
    const feature = new SmartStatus(client, 'smart_status');
    await updateOf(feature);
    (getNativeDiskIOStats as jest.Mock).mockResolvedValue([{ device: 'sda', rIO: 1000 + 10 * 1048576, wIO: 2000 }]);
    await updateOf(feature);
    const states = published(client);
    expect(states['system_agent/nivuus/smart_status/sda/read_speed/state']).toBe('1.00');
    expect(states['system_agent/nivuus/smart_status/sda/write_speed/state']).toBe('0.00');
  });

  // Two Windows disks named in Japanese and Chinese used to share one id, so
  // one overwrote the other's states.
  it('keeps remote disks with non-Latin names apart', async () => {
    const client = new MockMqttClient();
    await client.connect();
    await updateOf(new SmartStatus(client, 'smart_status'));
    const healthTopics = Object.keys(published(client))
      .filter((topic) => topic.endsWith('/health/state') && !/\/(sda|nvme0n1)\//.test(topic));
    expect(healthTopics).toHaveLength(2);
    expect(remoteCommand).toHaveBeenCalledWith('smartctl -j -a /dev/sda');
    expect(remoteCommand).toHaveBeenCalledWith('smartctl -j -a /dev/sdb');
  });
});
