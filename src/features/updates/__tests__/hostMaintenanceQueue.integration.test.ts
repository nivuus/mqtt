// src/features/updates/__tests__/hostMaintenanceQueue.integration.test.ts
//
// DockerUpdates and AptUpdates share one host-wide FIFO: an apt upgrade and a
// container recreate never run at the same time, whichever arrives first.

import { AptUpdates } from '../AptUpdates';
import { DockerUpdates } from '../DockerUpdates';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import * as DockerHelperModule from '../DockerHelper';
import { ContainerInfo } from '../DockerHelper';
import * as execModule from '../../../utils/exec';
import logger from '../../../utils/logger';

jest.mock('../DockerHelper');
jest.mock('../../../utils/exec');

const mockedHelper = DockerHelperModule as jest.Mocked<typeof DockerHelperModule>;
const mockedExec = execModule as jest.Mocked<typeof execModule>;

// Same pattern as DockerUpdates.test.ts, with both features enabled.
jest.mock('../../../config', () => {
  const actualConfig = jest.requireActual('../../../config');
  const mockConfigManagerInstance: any = {
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'TestDevice', identifiers: ['test-agent'], manufacturer: 'Test', model: 'Agent', sw_version: '1.0' },
      features: {
        apt_updates: { enabled: true },
        docker_updates: { enabled: true },
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

function ok(stdout: string = ''): CommandResult {
  return { stdout, stderr: '', exitCode: 0 };
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

const APT_COMMAND_TOPIC = 'system_agent/test-agent/apt_updates/apt/command';
const PLEX_COMMAND_TOPIC = 'system_agent/test-agent/docker_updates/plex/command';
const FIRST_UPGRADE_COMMAND = 'dpkg --configure -a';

const plex: ContainerInfo = {
  id: 'abc123',
  name: 'mediamanager-plex-1',
  serviceName: 'plex',
  image: 'lscr.io/linuxserver/plex:latest',
  imageId: 'sha256:deadbeef',
  composeFiles: ['docker-compose.yml'],
  envFiles: [],
  projectName: 'mediamanager',
  workingDir: '/stack',
  composeService: 'plex',
  installedVersion: '1.0.0',
  sourceUrl: '',
};

/**
 * Answers the apt feature's shell commands: the first `apt list` (the check
 * run by start()) offers one package, so an INSTALL has something to do;
 * every later listing is empty. `dpkg` can be held pending to keep the
 * upgrade running.
 */
function routeShellCommands(pendingDpkg?: Promise<CommandResult>) {
  let listed = false;
  return async (command: string): Promise<CommandResult> => {
    if (command.includes('apt list --upgradable')) {
      if (listed) return ok('');
      listed = true;
      return ok('curl/stable 8.1.0-1 amd64 [upgradable from: 8.0.0-1]\n');
    }
    if (command.includes(FIRST_UPGRADE_COMMAND) && pendingDpkg) return pendingDpkg;
    return ok();
  };
}

function upgradeStarted(): boolean {
  return mockedExec.execute_command.mock.calls.some(([command]) => command.includes(FIRST_UPGRADE_COMMAND));
}

describe('host maintenance queue shared by apt and container installs', () => {
  let mockMqttClient: MockMqttClient;
  let apt: AptUpdates;
  let docker: DockerUpdates;

  beforeEach(() => {
    // Pristine test output: every log line goes to a silent spy.
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
    jest.spyOn(logger, 'info').mockImplementation(() => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});

    mockMqttClient = new MockMqttClient();
    apt = new AptUpdates(mockMqttClient, 'apt_updates');
    docker = new DockerUpdates(mockMqttClient, 'docker_updates');

    mockedHelper.listWatchtowerContainers.mockResolvedValue([plex]);
    mockedHelper.checkContainerUpdate.mockResolvedValue({ hasUpdate: true, newVersion: '2.0.0', pullOutput: '' });
    mockedHelper.fetchChangelog.mockResolvedValue({ releaseSummary: '', releaseUrl: '' });
    mockedExec.execute_argv.mockResolvedValue(ok());
  });

  afterEach(async () => {
    await apt.stop();
    await docker.stop();
    jest.restoreAllMocks();
    mockMqttClient.reset();
  });

  async function startBoth(pendingDpkg?: Promise<CommandResult>): Promise<void> {
    mockedExec.execute_command.mockImplementation(routeShellCommands(pendingDpkg));
    await mockMqttClient.connect();
    await apt.start();
    await docker.start();
  }

  it('starts an apt install requested while a container install runs only after that install settles', async () => {
    await startBoth();
    const plexUpdate = defer<boolean>();
    mockedHelper.updateContainer.mockImplementationOnce(() => plexUpdate.promise);

    mockMqttClient.simulateMessage(PLEX_COMMAND_TOPIC, 'INSTALL');
    await flush();
    mockMqttClient.simulateMessage(APT_COMMAND_TOPIC, 'INSTALL');
    await flush();

    expect(mockedHelper.updateContainer).toHaveBeenCalledTimes(1);
    expect(upgradeStarted()).toBe(false);

    plexUpdate.resolve(true);
    await flush();

    expect(upgradeStarted()).toBe(true);
  });

  it('starts a container install requested while an apt install runs only after the upgrade settles', async () => {
    const dpkg = defer<CommandResult>();
    await startBoth(dpkg.promise);
    mockedHelper.updateContainer.mockResolvedValueOnce(true);

    mockMqttClient.simulateMessage(APT_COMMAND_TOPIC, 'INSTALL');
    await flush();
    mockMqttClient.simulateMessage(PLEX_COMMAND_TOPIC, 'INSTALL');
    await flush();

    expect(upgradeStarted()).toBe(true);
    expect(mockedHelper.updateContainer).not.toHaveBeenCalled();

    dpkg.resolve(ok());
    await flush();

    expect(mockedHelper.updateContainer).toHaveBeenCalledTimes(1);
  });
});
