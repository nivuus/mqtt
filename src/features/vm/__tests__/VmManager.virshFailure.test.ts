// src/features/vm/__tests__/VmManager.virshFailure.test.ts
//
// virsh failing (libvirtd down or restarting) is not "no VM". It used to be
// parsed as an empty list, so the feature withdrew every VM entity from Home
// Assistant, customisations included, on its next restart.

import { VmManager } from '../VmManager';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import { execute_argv } from '../../../utils/exec';
import logger from '../../../utils/logger';

jest.mock('../../../config', () => ({
  getConfigManager: jest.fn(() => ({
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Test', identifiers: ['nivuus'], manufacturer: 'T', model: 'A', sw_version: '1' },
      features: { vm_manager: { enabled: true, update_interval_seconds: 0 } },
    },
  })),
}));

jest.mock('../../../utils/exec', () => ({ execute_argv: jest.fn() }));
const exec = execute_argv as jest.MockedFunction<typeof execute_argv>;

const VIRSH_LIST = [
  ' Id   Name      State',
  '--------------------------',
  ' 1    Windows   running',
  '',
].join('\n');

const STATE_CONFIG_TOPIC = 'homeassistant/sensor/nivuus/nivuus_vm_manager_Windows_state/config';
const retainedStateConfig = JSON.stringify({ unique_id: 'nivuus_vm_manager_Windows_state', name: 'VM Windows State Sensor' });

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

let client: MockMqttClient;

beforeEach(async () => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {});
  }
  client = new MockMqttClient();
  await client.connect();
});

afterEach(() => jest.restoreAllMocks());

async function startAndReplayRetainedConfig(): Promise<void> {
  await new VmManager(client, 'vm_manager').start();
  client.simulateMessage(STATE_CONFIG_TOPIC, retainedStateConfig);
  await flush();
}

describe('VmManager when virsh cannot be read', () => {
  it.each([
    ['exits non-zero with no output', { stdout: '', stderr: 'error: failed to connect to the hypervisor', exitCode: 1 }],
    ['exits 0 without the list header', { stdout: 'unexpected\n', stderr: '', exitCode: 0 }],
  ])('withdraws no VM entity when virsh %s', async (_label, result) => {
    exec.mockResolvedValue(result);
    await startAndReplayRetainedConfig();

    const removals = client.publishedMessages.filter((m) => m.topic.startsWith('homeassistant/') && m.message === '');
    expect(removals).toEqual([]);
    const states = client.publishedMessages.filter((m) => m.topic.endsWith('/state'));
    expect(states.map((m) => m.message)).not.toContain('not_found');
  });

  it('still publishes and keeps the VM when virsh answers', async () => {
    exec.mockResolvedValue({ stdout: VIRSH_LIST, stderr: '', exitCode: 0 });
    await startAndReplayRetainedConfig();

    expect(client.publishedMessages.map((m) => m.topic)).toContain(STATE_CONFIG_TOPIC);
    expect(client.publishedMessages.filter((m) => m.message === '')).toEqual([]);
    expect(client.publishedMessages).toContainEqual(expect.objectContaining({
      topic: 'system_agent/nivuus/vm_manager/Windows/state', message: 'running',
    }));
  });

  it('withdraws a VM virsh no longer lists', async () => {
    exec.mockResolvedValue({ stdout: VIRSH_LIST.replace(' 1    Windows   running\n', ''), stderr: '', exitCode: 0 });
    await startAndReplayRetainedConfig();

    expect(client.publishedMessages).toContainEqual(expect.objectContaining({ topic: STATE_CONFIG_TOPIC, message: '' }));
  });
});
