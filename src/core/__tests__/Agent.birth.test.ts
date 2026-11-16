// src/core/__tests__/Agent.birth.test.ts
//
// The MQTT client does not resend a retained payload the broker already holds.
// Home Assistant's birth message asks for everything again: the agent must make
// the client forget what it sent before republishing, or a restarted Home
// Assistant would get none of the unchanged retained states.

import { MockMqttClient } from '../../mqtt/__tests__/mocks/MockMqttClient';
import logger from '../../utils/logger';

jest.mock('../../config', () => ({
  getConfigManager: jest.fn(() => ({
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Test', identifiers: ['nivuus'], manufacturer: 'T', model: 'A', sw_version: '1' },
      features: {},
    },
  })),
}));

const clients: MockMqttClient[] = [];
jest.mock('../../mqtt/MqttClient', () => ({
  MqttClient: jest.fn(() => {
    const client = new MockMqttClient();
    clients.push(client);
    return client;
  }),
}));

import { Agent } from '../Agent';

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {});
  }
});

afterEach(() => jest.restoreAllMocks());

/** The agent installs process-wide handlers that exit; keep them out of the test runner. */
function newAgent(): Agent {
  const onSpy = jest.spyOn(process, 'on').mockImplementation(() => process);
  try {
    return new Agent();
  } finally {
    onSpy.mockRestore();
  }
}

/** Let the serialized republish triggered by an event run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe('Agent on Home Assistant birth', () => {
  it('makes the MQTT client resend unchanged retained payloads before republishing', async () => {
    const agent = newAgent();
    await agent.start();
    const client = clients[clients.length - 1];
    await settle();
    const afterConnection = client.forgetRetainedCalls;

    client.simulateMessage('homeassistant/status', 'online');
    await settle();

    expect(client.forgetRetainedCalls).toBe(afterConnection + 1);
  });
});
