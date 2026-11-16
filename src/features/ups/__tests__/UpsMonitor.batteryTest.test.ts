// src/features/ups/__tests__/UpsMonitor.batteryTest.test.ts
//
// The battery test is an authenticated NUT instant command. Its password must
// never reach a command line: `upscmd -p <password>` was readable by every
// local user in /proc/<pid>/cmdline. It goes to upsd over its socket instead.

import { UpsMonitor } from '../UpsMonitor';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import { execute_argv } from '../../../utils/exec';
import { runNutInstantCommand } from '../nutInstantCommand';
import logger from '../../../utils/logger';

jest.mock('../../../utils/exec', () => ({ execute_argv: jest.fn() }));
jest.mock('../nutInstantCommand', () => ({ runNutInstantCommand: jest.fn() }));

jest.mock('../../../config', () => ({
  getConfigManager: jest.fn(() => ({
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'Test', identifiers: ['nivuus'], manufacturer: 'T', model: 'A', sw_version: '1' },
      features: { ups_monitor: { enabled: true, ups_name: 'myups@localhost' } },
    },
  })),
}));

const LISTING = `Instant commands supported on UPS [myups]:

test.battery.start.deep - Start a deep battery test
test.battery.start.quick - Start a quick battery test
`;

const mockedExec = execute_argv as jest.MockedFunction<typeof execute_argv>;
const mockedRun = runNutInstantCommand as jest.MockedFunction<typeof runNutInstantCommand>;

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {});
  }
  process.env.NUT_USERNAME = 'mqtt-agent';
  process.env.NUT_PASSWORD = 'not-a-real-secret';
  mockedExec.mockResolvedValue({ stdout: LISTING, stderr: '', exitCode: 0 });
  mockedRun.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.NUT_USERNAME;
  delete process.env.NUT_PASSWORD;
  jest.restoreAllMocks();
});

const startBatteryTest = (feature: UpsMonitor) =>
  (feature as unknown as { startBatteryTest: () => Promise<boolean> }).startBatteryTest();

describe('UpsMonitor battery test', () => {
  it('never puts the NUT password on a command line', async () => {
    const ok = await startBatteryTest(new UpsMonitor(new MockMqttClient(), 'ups_monitor'));
    expect(ok).toBe(true);
    for (const [, args] of mockedExec.mock.calls) {
      expect(args).not.toContain('not-a-real-secret');
    }
  });

  it('sends the quick test to upsd with the credentials', async () => {
    await startBatteryTest(new UpsMonitor(new MockMqttClient(), 'ups_monitor'));
    expect(mockedRun).toHaveBeenCalledWith('myups@localhost', 'test.battery.start.quick', {
      username: 'mqtt-agent', password: 'not-a-real-secret',
    });
  });

  it('reports a refused command as a failed test', async () => {
    mockedRun.mockRejectedValue(new Error('upsd refused INSTCMD: ERR ACCESS-DENIED'));
    const ok = await startBatteryTest(new UpsMonitor(new MockMqttClient(), 'ups_monitor'));
    expect(ok).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ACCESS-DENIED'));
  });
});
