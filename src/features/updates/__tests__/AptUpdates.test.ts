// src/features/updates/__tests__/AptUpdates.test.ts

import { AptUpdates } from '../AptUpdates';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import * as execModule from '../../../utils/exec';
import logger from '../../../utils/logger';

jest.mock('../../../utils/exec');

const mockedExec = execModule as jest.Mocked<typeof execModule>;

// Mock initializeConfigManager and getConfigManager, same pattern as
// src/features/updates/__tests__/DockerUpdates.test.ts.
jest.mock('../../../config', () => {
  const actualConfig = jest.requireActual('../../../config');
  const mockConfigManagerInstance: any = {
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'TestDevice', identifiers: ['test-agent'], manufacturer: 'Test', model: 'Agent', sw_version: '1.0' },
      features: {
        apt_updates: { enabled: true },
      },
      logging: { level: 'info' },
    },
    getFeatureConfig: jest.fn((featureName: string) => mockConfigManagerInstance.config.features[featureName] || { enabled: false }),
  };
  return {
    ...actualConfig,
    initializeConfigManager: jest.fn(() => mockConfigManagerInstance),
    getConfigManager: jest.fn(() => mockConfigManagerInstance),
  };
});

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function ok(stdout: string = ''): CommandResult {
  return { stdout, stderr: '', exitCode: 0 };
}

// The compose flags that take a value, so the subcommand finder below can
// skip past them -- mirrors DockerHelper.test.ts's own helper for the same
// kind of argv (here just `-p` and `-f`, AptUpdates never sets
// --project-directory or --env-file).
const COMPOSE_FLAGS_WITH_VALUE = new Set(['-p', '-f']);

function composeSubcommand(args: string[]): string | undefined {
  if (args[0] !== 'compose') return undefined;
  let i = 1;
  while (i < args.length) {
    const token = args[i];
    if (COMPOSE_FLAGS_WITH_VALUE.has(token)) {
      i += 2;
      continue;
    }
    return token;
  }
  return undefined;
}

function projectNameOf(args: string[]): string | undefined {
  const index = args.indexOf('-p');
  return index >= 0 ? args[index + 1] : undefined;
}

function findCall(predicate: (args: string[]) => boolean): string[] | undefined {
  const call = mockedExec.execute_argv.mock.calls.find(
    ([file, args]) => file === 'docker' && predicate(args as string[])
  );
  return call ? (call[1] as string[]) : undefined;
}

interface ComposeProjectFixture {
  Name: string;
  ConfigFiles: string;
}

interface Routing {
  projects: ComposeProjectFixture[];
  // Project name -> stdout of `compose ... ps --services --status running`.
  runningByProject: Record<string, string>;
  // Project name -> stderr; when set, that project's `ps` call exits non-zero.
  psFailureByProject?: Record<string, string>;
  // Project name -> stderr; when set, that project's `up` call exits non-zero.
  upFailureByProject?: Record<string, string>;
}

/**
 * Routes every `docker` argv call issued while restarting compose projects:
 * the daemon-ready probe, the project listing, the per-project
 * running-services snapshot, and the final recreate. Anything else succeeds
 * trivially, same as the "generic success" fallback in DockerHelper.test.ts.
 */
function routeExecuteArgv(routing: Routing) {
  return async (file: string, args: string[]): Promise<CommandResult> => {
    if (file !== 'docker') return ok();
    if (args[0] === 'info') return ok();
    if (args[0] === 'compose' && args[1] === 'ls') {
      return ok(JSON.stringify(routing.projects));
    }

    const sub = composeSubcommand(args);
    const name = projectNameOf(args) ?? '';

    if (sub === 'ps') {
      if (routing.psFailureByProject && name in routing.psFailureByProject) {
        return { stdout: '', stderr: routing.psFailureByProject[name], exitCode: 1 };
      }
      return ok(routing.runningByProject[name] ?? '');
    }

    if (sub === 'up' && routing.upFailureByProject && name in routing.upFailureByProject) {
      return { stdout: '', stderr: routing.upFailureByProject[name], exitCode: 1 };
    }

    // up (success) and anything else: generic success.
    return ok();
  };
}

function aptCommandTopic(): string {
  return 'system_agent/test-agent/apt_updates/apt/command';
}

// One microtask drain is not enough to walk the chain of internal awaits in
// installUpdates (dpkg -> dist-upgrade -> recheck -> autoremove -> compose
// snapshot/restart -> final recheck); a macrotask boundary guarantees every
// already-resolved microtask has run. Same technique as DockerUpdates.test.ts.
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('AptUpdates compose restarts', () => {
  let mockMqttClient: MockMqttClient;
  let feature: AptUpdates;

  beforeEach(() => {
    mockMqttClient = new MockMqttClient();
    feature = new AptUpdates(mockMqttClient, 'apt_updates');

    mockedExec.execute_command.mockResolvedValue(ok());
    // The very first `apt list --upgradable` call, made by checkForUpdates()
    // during start(), is what decides `dockerUpdated`: it must report a
    // docker package so installUpdates() takes the compose-restart path at
    // all. This is the existing detection the task keeps unchanged.
    mockedExec.execute_command.mockImplementationOnce(async () =>
      ok('docker-ce/jammy 5:24.0.7-1~ubuntu.22.04~jammy amd64 [upgradable from: 5:24.0.6-1~ubuntu.22.04~jammy]\n')
    );
  });

  afterEach(async () => {
    await feature.stop();
    jest.restoreAllMocks();
    mockMqttClient.reset();
  });

  async function installWithCompose(routing: Routing): Promise<void> {
    mockedExec.execute_argv.mockImplementation(routeExecuteArgv(routing));
    await mockMqttClient.connect();
    await feature.start();
    mockMqttClient.simulateMessage(aptCommandTopic(), 'INSTALL');
    await flush();
  }

  it("splits a project's ConfigFiles into one -f per file, in order", async () => {
    await installWithCompose({
      projects: [{ Name: 'mediamanager', ConfigFiles: '/stack/docker-compose.yml,/stack/docker-compose.qsv.yml' }],
      runningByProject: { mediamanager: 'plex' },
    });

    expect(findCall(args => args[0] === 'compose' && args[1] === 'ls')).toEqual([
      'compose', 'ls', '--all', '--format', 'json',
    ]);

    const upCall = findCall(args => composeSubcommand(args) === 'up');
    expect(upCall).toEqual([
      'compose', '-p', 'mediamanager',
      '-f', '/stack/docker-compose.yml', '-f', '/stack/docker-compose.qsv.yml',
      'up', '-d', '--force-recreate', '--no-deps', 'plex',
    ]);
  });

  it('recreates only the services that were running before the upgrade', async () => {
    await installWithCompose({
      projects: [{ Name: 'mediamanager', ConfigFiles: '/stack/docker-compose.yml' }],
      runningByProject: { mediamanager: 'plex\ntautulli' },
    });

    expect(findCall(args => composeSubcommand(args) === 'ps')).toEqual([
      'compose', '-p', 'mediamanager', '-f', '/stack/docker-compose.yml',
      'ps', '--services', '--status', 'running',
    ]);
    expect(findCall(args => composeSubcommand(args) === 'up')).toEqual([
      'compose', '-p', 'mediamanager', '-f', '/stack/docker-compose.yml',
      'up', '-d', '--force-recreate', '--no-deps', 'plex', 'tautulli',
    ]);
  });

  it('issues no up command for a project with no running service, while still recreating one that has running services', async () => {
    await installWithCompose({
      projects: [
        { Name: 'mediamanager', ConfigFiles: '/stack/docker-compose.yml' },
        { Name: 'console', ConfigFiles: '/opt/console/docker-compose.yml' },
      ],
      runningByProject: { mediamanager: 'plex', console: '' },
    });

    expect(findCall(args => composeSubcommand(args) === 'up' && args.includes('/opt/console/docker-compose.yml'))).toBeUndefined();
    expect(findCall(args => composeSubcommand(args) === 'up' && args.includes('/stack/docker-compose.yml'))).toEqual([
      'compose', '-p', 'mediamanager', '-f', '/stack/docker-compose.yml',
      'up', '-d', '--force-recreate', '--no-deps', 'plex',
    ]);
  });

  it('logs the failing project by name and stderr when a per-project ps call fails, and still restarts the other project', async () => {
    const errorSpy = jest.spyOn(logger, 'error');
    await installWithCompose({
      projects: [
        { Name: 'mediamanager', ConfigFiles: '/stack/docker-compose.yml' },
        { Name: 'broken', ConfigFiles: '/opt/broken/docker-compose.yml' },
      ],
      runningByProject: { mediamanager: 'plex' },
      psFailureByProject: { broken: 'Error: no such service' },
    });

    expect(findCall(args => composeSubcommand(args) === 'up' && args.includes('/stack/docker-compose.yml'))).toEqual([
      'compose', '-p', 'mediamanager', '-f', '/stack/docker-compose.yml',
      'up', '-d', '--force-recreate', '--no-deps', 'plex',
    ]);
    expect(findCall(args => composeSubcommand(args) === 'up' && args.includes('/opt/broken/docker-compose.yml'))).toBeUndefined();
    expect(errorSpy.mock.calls.some(
      ([message]) => typeof message === 'string' && message.includes('broken') && message.includes('no such service')
    )).toBe(true);
  });

  it('logs a compose project that has no Name instead of silently skipping it', async () => {
    const errorSpy = jest.spyOn(logger, 'error');
    await installWithCompose({
      projects: [
        { Name: 'mediamanager', ConfigFiles: '/stack/docker-compose.yml' },
        { Name: '', ConfigFiles: '/opt/nameless/docker-compose.yml' },
      ],
      runningByProject: { mediamanager: 'plex' },
    });

    expect(findCall(args => composeSubcommand(args) === 'up' && args.includes('/stack/docker-compose.yml'))).toBeDefined();
    expect(errorSpy.mock.calls.some(
      ([message]) => typeof message === 'string' && message.includes('/opt/nameless/docker-compose.yml')
    )).toBe(true);
  });

  it('logs an error naming the project and its stderr when the recreate itself fails, and still recreates the next project', async () => {
    const errorSpy = jest.spyOn(logger, 'error');
    await installWithCompose({
      projects: [
        { Name: 'broken', ConfigFiles: '/opt/broken/docker-compose.yml' },
        { Name: 'mediamanager', ConfigFiles: '/stack/docker-compose.yml' },
      ],
      runningByProject: { broken: 'plex', mediamanager: 'sonarr' },
      upFailureByProject: { broken: 'Error: driver failed programming external connectivity' },
    });

    expect(errorSpy.mock.calls.some(
      ([message]) => typeof message === 'string'
        && message.includes('broken')
        && message.includes('driver failed programming external connectivity')
    )).toBe(true);
    expect(findCall(args => composeSubcommand(args) === 'up' && args.includes('/stack/docker-compose.yml'))).toEqual([
      'compose', '-p', 'mediamanager', '-f', '/stack/docker-compose.yml',
      'up', '-d', '--force-recreate', '--no-deps', 'sonarr',
    ]);
  });
});
