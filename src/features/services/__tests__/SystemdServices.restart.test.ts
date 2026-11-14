// src/features/services/__tests__/SystemdServices.restart.test.ts
//
// Restarting docker, firewalld or NetworkManager takes the household off line.
// Only the restart button's own press may do it: any message on the command
// topic, an empty or a retained one included, used to restart the unit.

import { SystemdServices } from '../SystemdServices';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import { execute_argv } from '../../../utils/exec';
import logger from '../../../utils/logger';

jest.mock('../../../config', () => ({
  getConfigManager: jest.fn(() => ({
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Test', identifiers: ['nivuus'], manufacturer: 'T', model: 'A', sw_version: '1' },
      features: { systemd_services: { enabled: true, update_interval_seconds: 0 } },
    },
  })),
}));

jest.mock('../../../utils/exec', () => ({ execute_argv: jest.fn() }));
const exec = execute_argv as jest.MockedFunction<typeof execute_argv>;

const RESTART_TOPIC = 'system_agent/nivuus/systemd_services/firewalld/restart';
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const restarts = () => exec.mock.calls.filter(([, args]) => args.includes('restart'));

let client: MockMqttClient;

beforeEach(async () => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {});
  }
  // is-active answers "active"; a restart "fails" so no settle delay is awaited.
  exec.mockImplementation(async (_file, args) =>
    args.includes('restart') ? { stdout: '', stderr: 'test', exitCode: 1 } : { stdout: 'active\n', stderr: '', exitCode: 0 });
  client = new MockMqttClient();
  await client.connect();
  await new SystemdServices(client, 'systemd_services').start();
});

afterEach(() => jest.restoreAllMocks());

describe('SystemdServices restart command', () => {
  it('declares the press payload it requires in the button discovery', () => {
    const button = client.publishedMessages.find((m) =>
      m.topic === 'homeassistant/button/nivuus/nivuus_service_firewalld_restart/config');
    expect(JSON.parse(String(button!.message))).toMatchObject({ command_topic: RESTART_TOPIC, payload_press: 'PRESS' });
  });

  it.each([
    ['an empty payload', ''],
    ['a wrong payload', 'restart'],
    ['a payload differing in case', 'press'],
  ])('ignores %s', async (_label, payload) => {
    client.simulateMessage(RESTART_TOPIC, payload);
    await flush();
    expect(restarts()).toEqual([]);
  });

  it('ignores a retained press', async () => {
    client.simulateMessage(RESTART_TOPIC, 'PRESS', { retain: true });
    await flush();
    expect(restarts()).toEqual([]);
  });

  it('restarts the unit on the exact press payload', async () => {
    client.simulateMessage(RESTART_TOPIC, 'PRESS');
    await flush();
    expect(restarts()).toEqual([['sudo', ['systemctl', 'restart', 'firewalld.service']]]);
  });
});
