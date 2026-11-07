// src/features/ups/nutCommands.ts

/**
 * Battery test commands in order of preference. UPS models expose different
 * subsets (an APC Back-UPS BX1600MI only has the `.quick` and `.deep`
 * variants), so the command is chosen from what `upscmd -l` reports instead of
 * being hardcoded. The deep test is never chosen: it drains the battery while
 * the host is running on it.
 */
const BATTERY_TEST_PREFERENCE = ['test.battery.start.quick', 'test.battery.start'];

export interface NutCredentials {
  username: string;
  password: string;
}

/** Parses `upscmd -l <ups>` output: one `name - description` line per command. */
export function parseInstantCommands(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.match(/^([a-z0-9_.]+) - /i)?.[1])
    .filter((name): name is string => Boolean(name));
}

export function pickBatteryTestCommand(available: string[]): string | null {
  return BATTERY_TEST_PREFERENCE.find((command) => available.includes(command)) ?? null;
}

/**
 * NUT credentials come from the environment (`/etc/mqtt-system-agent.env`),
 * never from the code or the packaged config: a .deb install overwrites the
 * config, and a default password would let any local process drive the UPS.
 */
export function nutCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): NutCredentials | null {
  const username = env.NUT_USERNAME;
  const password = env.NUT_PASSWORD;
  return username && password ? { username, password } : null;
}
