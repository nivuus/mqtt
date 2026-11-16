// src/cli/__tests__/cli.test.ts
//
// `mqtt-system-agent alert` was routed to the CLI, which never handled it.
// The command is gone; any positional command still goes to the CLI, so an
// unknown one exits with an error instead of starting a second agent.

import { runCli, selectMode } from '../index';
import { MqttMessageSender } from '../MqttMessageSender';

jest.mock('../MqttMessageSender', () => ({ MqttMessageSender: { send: jest.fn() } }));

describe('CLI dispatch', () => {
  it('starts the agent only without a command', () => {
    expect(selectMode(undefined)).toBe('agent');
    expect(selectMode('event')).toBe('cli');
    expect(selectMode('alert')).toBe('cli');
    expect(selectMode('typo')).toBe('cli');
  });

  it('rejects alert and other unknown commands without touching the broker', async () => {
    await expect(runCli('alert', { _: ['alert'] })).rejects.toThrow('Unknown CLI command: alert. Supported: event.');
    expect(MqttMessageSender.send).not.toHaveBeenCalled();
  });

  it('sends an event', async () => {
    await runCli('event', { _: ['event', 'backup_done'] });
    expect(MqttMessageSender.send).toHaveBeenCalledWith('event', expect.objectContaining({ type: 'backup_done' }));
  });
});
