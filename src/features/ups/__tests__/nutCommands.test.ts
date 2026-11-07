// src/features/ups/__tests__/nutCommands.test.ts

import { nutCredentialsFromEnv, parseInstantCommands, pickBatteryTestCommand } from '../nutCommands';

// Verbatim `upscmd -l myups@localhost` output of an APC Back-UPS BX1600MI.
const BX1600MI_LISTING = `Instant commands supported on UPS [myups]:

beeper.disable - Disable the UPS beeper
load.off - Turn off the load immediately
shutdown.stop - Stop a shutdown in progress
test.battery.start.deep - Start a deep battery test
test.battery.start.quick - Start a quick battery test
test.battery.stop - Stop the battery test
`;

describe('parseInstantCommands', () => {
  it('extracts command names and skips the header line', () => {
    expect(parseInstantCommands(BX1600MI_LISTING)).toEqual([
      'beeper.disable',
      'load.off',
      'shutdown.stop',
      'test.battery.start.deep',
      'test.battery.start.quick',
      'test.battery.stop',
    ]);
  });
});

describe('pickBatteryTestCommand', () => {
  it('prefers the quick test on a UPS that has no generic test command', () => {
    expect(pickBatteryTestCommand(parseInstantCommands(BX1600MI_LISTING))).toBe('test.battery.start.quick');
  });

  it('falls back to the generic test when no quick variant exists', () => {
    expect(pickBatteryTestCommand(['test.battery.start', 'test.battery.stop'])).toBe('test.battery.start');
  });

  it('never picks the deep test, which drains the battery under load', () => {
    expect(pickBatteryTestCommand(['test.battery.start.deep', 'test.battery.stop'])).toBeNull();
  });
});

describe('nutCredentialsFromEnv', () => {
  it('reads both values from the environment', () => {
    expect(nutCredentialsFromEnv({ NUT_USERNAME: 'agent', NUT_PASSWORD: 's3cret' })).toEqual({
      username: 'agent',
      password: 's3cret',
    });
  });

  it('returns null rather than a default when either value is missing', () => {
    expect(nutCredentialsFromEnv({ NUT_USERNAME: 'agent' })).toBeNull();
    expect(nutCredentialsFromEnv({})).toBeNull();
  });
});
