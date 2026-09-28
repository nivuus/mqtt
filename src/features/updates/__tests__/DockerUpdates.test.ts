// src/features/updates/__tests__/DockerUpdates.test.ts

import { DockerUpdates } from '../DockerUpdates';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import * as DockerHelperModule from '../DockerHelper';
import { ContainerInfo } from '../DockerHelper';
import logger from '../../../utils/logger';

jest.mock('../DockerHelper');

const mockedHelper = DockerHelperModule as jest.Mocked<typeof DockerHelperModule>;

// Mock initializeConfigManager and getConfigManager, same pattern as
// src/features/cpu/__tests__/CpuLoad.test.ts.
jest.mock('../../../config', () => {
  const actualConfig = jest.requireActual('../../../config');
  const mockConfigManagerInstance: any = {
    config: {
      mqtt: { host: 'localhost', port: 1883, base_topic: 'system_agent' },
      device_info: { name: 'TestDevice', identifiers: ['test-agent'], manufacturer: 'Test', model: 'Agent', sw_version: '1.0' },
      features: {
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// One microtask drain is not enough to walk the chain of internal awaits
// (publishContainerState -> mqtt publish -> queue link -> runInstall); a
// macrotask boundary guarantees every already-resolved microtask has run.
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function installTopic(serviceId: string): string {
  return `system_agent/test-agent/docker_updates/${serviceId}/command`;
}

function buildContainer(overrides: Partial<ContainerInfo> = {}): ContainerInfo {
  return {
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
    ...overrides,
  };
}

describe('DockerUpdates install queue', () => {
  let mockMqttClient: MockMqttClient;
  let feature: DockerUpdates;

  beforeEach(() => {
    // Pristine test output: every log line goes to a silent spy. A test that
    // asserts on a log reads the same spy (jest.spyOn returns the existing mock).
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
    jest.spyOn(logger, 'info').mockImplementation(() => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});

    mockMqttClient = new MockMqttClient();
    feature = new DockerUpdates(mockMqttClient, 'docker_updates');

    mockedHelper.checkContainerUpdate.mockResolvedValue({ hasUpdate: false, newVersion: '', pullOutput: '' });
    mockedHelper.fetchChangelog.mockResolvedValue({ releaseSummary: '', releaseUrl: '' });
  });

  afterEach(async () => {
    await feature.stop();
    jest.restoreAllMocks();
    mockMqttClient.reset();
  });

  async function startWithContainers(containers: ContainerInfo[]): Promise<void> {
    mockedHelper.listWatchtowerContainers.mockResolvedValue(containers);
    mockMqttClient.connect();
    await feature.start();
  }

  it('starts the second install only after the first updateContainer call resolves', async () => {
    const plex = buildContainer({ serviceName: 'plex', name: 'plex-1' });
    const sonarr = buildContainer({ serviceName: 'sonarr', name: 'sonarr-1', composeService: 'sonarr' });
    await startWithContainers([plex, sonarr]);

    const plexUpdate = defer<boolean>();
    const sonarrUpdate = defer<boolean>();
    mockedHelper.updateContainer
      .mockImplementationOnce(() => plexUpdate.promise)
      .mockImplementationOnce(() => sonarrUpdate.promise);

    mockMqttClient.simulateMessage(installTopic('plex'), 'INSTALL');
    mockMqttClient.simulateMessage(installTopic('sonarr'), 'INSTALL');
    await flush();

    // Only the first arrival has reached updateContainer; the second is
    // waiting on the queue, not running concurrently.
    expect(mockedHelper.updateContainer).toHaveBeenCalledTimes(1);
    expect(mockedHelper.updateContainer).toHaveBeenCalledWith(expect.objectContaining({ serviceName: 'plex' }));

    plexUpdate.resolve(true);
    await flush();

    expect(mockedHelper.updateContainer).toHaveBeenCalledTimes(2);
    expect(mockedHelper.updateContainer).toHaveBeenNthCalledWith(2, expect.objectContaining({ serviceName: 'sonarr' }));

    sonarrUpdate.resolve(true);
    await flush();
  });

  it('starts the second install even when the first one fails', async () => {
    const plex = buildContainer({ serviceName: 'plex', name: 'plex-1' });
    const sonarr = buildContainer({ serviceName: 'sonarr', name: 'sonarr-1', composeService: 'sonarr' });
    await startWithContainers([plex, sonarr]);

    const plexUpdate = defer<boolean>();
    mockedHelper.updateContainer
      .mockImplementationOnce(() => plexUpdate.promise)
      .mockResolvedValueOnce(true);

    mockMqttClient.simulateMessage(installTopic('plex'), 'INSTALL');
    mockMqttClient.simulateMessage(installTopic('sonarr'), 'INSTALL');
    await flush();

    expect(mockedHelper.updateContainer).toHaveBeenCalledTimes(1);

    plexUpdate.reject(new Error('compose pull failed'));
    await flush();

    expect(mockedHelper.updateContainer).toHaveBeenCalledTimes(2);
    expect(mockedHelper.updateContainer).toHaveBeenNthCalledWith(2, expect.objectContaining({ serviceName: 'sonarr' }));
  });

  it('ignores a repeated install command for a container that is already queued', async () => {
    const plex = buildContainer({ serviceName: 'plex', name: 'plex-1' });
    const sonarr = buildContainer({ serviceName: 'sonarr', name: 'sonarr-1', composeService: 'sonarr' });
    await startWithContainers([plex, sonarr]);

    const plexUpdate = defer<boolean>();
    const sonarrUpdate = defer<boolean>();
    mockedHelper.updateContainer
      .mockImplementationOnce(() => plexUpdate.promise)
      .mockImplementationOnce(() => sonarrUpdate.promise);

    mockMqttClient.simulateMessage(installTopic('plex'), 'INSTALL'); // starts running
    mockMqttClient.simulateMessage(installTopic('sonarr'), 'INSTALL'); // queued behind plex
    mockMqttClient.simulateMessage(installTopic('sonarr'), 'INSTALL'); // repeated while queued: ignored
    await flush();

    expect(mockedHelper.updateContainer).toHaveBeenCalledTimes(1);

    plexUpdate.resolve(true);
    await flush();

    // Exactly one sonarr install runs, not two.
    expect(mockedHelper.updateContainer).toHaveBeenCalledTimes(2);

    sonarrUpdate.resolve(true);
    await flush();
  });

  it('keeps the queue alive when the state publish after a successful install rejects', async () => {
    const plex = buildContainer({ serviceName: 'plex', name: 'plex-1' });
    const sonarr = buildContainer({ serviceName: 'sonarr', name: 'sonarr-1', composeService: 'sonarr' });
    await startWithContainers([plex, sonarr]);

    const plexUpdate = defer<boolean>();
    mockedHelper.updateContainer
      .mockImplementationOnce(() => plexUpdate.promise)
      .mockResolvedValueOnce(true);

    mockMqttClient.simulateMessage(installTopic('plex'), 'INSTALL');
    mockMqttClient.simulateMessage(installTopic('sonarr'), 'INSTALL');
    await flush();

    expect(mockedHelper.updateContainer).toHaveBeenCalledTimes(1);

    // Simulates a transient MQTT failure (e.g. a QoS 1 publish that never
    // gets its PUBACK) on the state publish that follows a successful
    // install -- the real MqttClient wrapper's publish() does reject in
    // that case (src/mqtt/MqttClient.ts).
    jest.spyOn(mockMqttClient, 'publish').mockRejectedValueOnce(new Error('broker unreachable'));

    plexUpdate.resolve(true);
    await flush();

    // Sonarr's install must still run: one rejected link must never
    // freeze every install queued behind it for the rest of the process.
    expect(mockedHelper.updateContainer).toHaveBeenCalledTimes(2);
    expect(mockedHelper.updateContainer).toHaveBeenNthCalledWith(2, expect.objectContaining({ serviceName: 'sonarr' }));
  });
});
