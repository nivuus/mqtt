// src/core/__tests__/Agent.connect.test.ts
//
// The broker can drop again right after a connection. A failed publish in the
// 'connect' listener must be logged, not escape as an unhandled rejection: the
// agent exits on those, killing whatever privileged action was in flight. The
// next connection runs the listener again.

import { MockMqttClient } from '../../mqtt/__tests__/mocks/MockMqttClient';
import { unhandledRejectionsDuring } from '../../mqtt/__tests__/mocks/unhandledRejections';
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

/** Never reaches a broker: connect() stays pending, publish() fails as on a dropped link. */
class DroppingClient extends MockMqttClient {
  connect(): Promise<void> { return new Promise(() => undefined); }
  async publish(): Promise<this> { throw new Error('connection closed'); }
}

const clients: DroppingClient[] = [];
jest.mock('../../mqtt/MqttClient', () => ({
  MqttClient: jest.fn(() => {
    const client = new DroppingClient();
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

/** The agent installs process-wide handlers that exit; keep them out of the test runner. */
function newAgent(): Agent {
  const onSpy = jest.spyOn(process, 'on').mockImplementation(() => process);
  try {
    return new Agent();
  } finally {
    onSpy.mockRestore();
  }
}

afterEach(() => jest.restoreAllMocks());

describe('Agent connect listener', () => {
  it('logs a failed availability publish instead of leaving an unhandled rejection', async () => {
    const agent = newAgent();
    await agent.start();
    const client = clients[clients.length - 1];

    const reasons = await unhandledRejectionsDuring(async () => {
      client.connected = true;
      client.emit('connect');
    });

    expect(reasons).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/connect/i), expect.any(Error));
  });
});
