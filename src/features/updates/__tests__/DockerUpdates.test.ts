// src/features/updates/__tests__/DockerUpdates.test.ts

import { DockerUpdates } from '../DockerUpdates';
import { MockMqttClient } from '../../../mqtt/__tests__/mocks/MockMqttClient';
import * as DockerHelperModule from '../DockerHelper';
import { ContainerInfo, UpdateCheckResult } from '../DockerHelper';
import { runExclusive } from '../hostMaintenanceQueue';
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

// Exposes the periodic update the feature's own timer drives, so a test can
// run a check at a chosen moment instead of waiting check_interval_hours.
class TestableDockerUpdates extends DockerUpdates {
  runPeriodicUpdate(): Promise<void> {
    return this.update();
  }
}

describe('DockerUpdates install queue', () => {
  let mockMqttClient: MockMqttClient;
  let feature: TestableDockerUpdates;

  beforeEach(() => {
    // Pristine test output: every log line goes to a silent spy. A test that
    // asserts on a log reads the same spy (jest.spyOn returns the existing mock).
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
    jest.spyOn(logger, 'info').mockImplementation(() => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});

    mockMqttClient = new MockMqttClient();
    feature = new TestableDockerUpdates(mockMqttClient, 'docker_updates');

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

  // In the tests below, a rejection that escaped the 'message' listener would
  // fail the test on its own: jest reports it as an unhandled rejection, the
  // same event that makes the agent exit in production (Agent.ts).
  it('carries on with the install when the in_progress publish rejects', async () => {
    const plex = buildContainer({ serviceName: 'plex', name: 'plex-1' });
    await startWithContainers([plex]);
    mockedHelper.updateContainer.mockResolvedValueOnce(true);

    // A QoS 1 publish whose PUBACK is lost when the connection drops:
    // mqtt.js rejects it at the next reconnect.
    jest.spyOn(mockMqttClient, 'publish').mockRejectedValueOnce(new Error('Connection closed'));

    mockMqttClient.simulateMessage(installTopic('plex'), 'INSTALL');
    await flush();

    expect(mockedHelper.updateContainer).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('plex-1'), 'Connection closed');
    const published = mockMqttClient.publishedMessages;
    expect(JSON.parse(String(published[published.length - 1].message))).toEqual(
      expect.objectContaining({ in_progress: false })
    );
  });

  it("catches a rejection from the command handler at the 'message' listener and logs it", async () => {
    const plex = buildContainer({ serviceName: 'plex', name: 'plex-1' });
    await startWithContainers([plex]);
    // Stands in for any failure inside the handler: the listener is the last
    // place it can be caught, since an EventEmitter drops what a listener
    // returns.
    jest.spyOn(feature as any, 'installContainer').mockRejectedValueOnce(new Error('unexpected failure'));

    mockMqttClient.simulateMessage(installTopic('plex'), 'INSTALL');
    await flush();

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(installTopic('plex')), 'unexpected failure');
  });

  describe('across a periodic check', () => {
    const plex = buildContainer({ serviceName: 'plex', name: 'plex-1' });
    const sonarr = buildContainer({ serviceName: 'sonarr', name: 'sonarr-1', composeService: 'sonarr' });

    // update() only checks again once the default 12 h check interval has
    // elapsed since the last check.
    function runPeriodicCheck(): Promise<void> {
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 13 * 3600 * 1000);
      return feature.runPeriodicUpdate();
    }

    function lastPublishedState(serviceId: string): Record<string, unknown> {
      const topic = `system_agent/test-agent/docker_updates/${serviceId}/state`;
      const states = mockMqttClient.publishedMessages.filter(message => message.topic === topic);
      return JSON.parse(String(states[states.length - 1].message));
    }

    function entityRemoved(serviceId: string): boolean {
      const topic = `homeassistant/update/test-agent/test-agent_docker_updates_${serviceId}/config`;
      return mockMqttClient.publishedMessages.some(message => message.topic === topic && message.message === '');
    }

    it('keeps a queued install in progress, and a repeated INSTALL for it ignored', async () => {
      await startWithContainers([plex, sonarr]);
      const plexUpdate = defer<boolean>();
      const sonarrUpdate = defer<boolean>();
      mockedHelper.updateContainer
        .mockImplementationOnce(() => plexUpdate.promise)
        .mockImplementationOnce(() => sonarrUpdate.promise);

      mockMqttClient.simulateMessage(installTopic('plex'), 'INSTALL'); // running
      mockMqttClient.simulateMessage(installTopic('sonarr'), 'INSTALL'); // queued
      await flush();

      await runPeriodicCheck();

      expect(lastPublishedState('sonarr')).toEqual(expect.objectContaining({ in_progress: true }));

      mockMqttClient.simulateMessage(installTopic('sonarr'), 'INSTALL'); // repeated: ignored
      plexUpdate.resolve(true);
      await flush();
      sonarrUpdate.resolve(true);
      await flush();

      expect(mockedHelper.updateContainer).toHaveBeenCalledTimes(2);
    });

    it("publishes the versions the install put in place once it finishes, not the check's", async () => {
      await startWithContainers([plex]);
      const plexUpdate = defer<boolean>();
      mockedHelper.updateContainer.mockImplementationOnce(() => plexUpdate.promise);
      mockMqttClient.simulateMessage(installTopic('plex'), 'INSTALL');
      await flush();

      // The check runs during the install: it still sees 1.0.0 installed,
      // with 2.0.0 available.
      mockedHelper.checkContainerUpdate.mockResolvedValue({ hasUpdate: true, newVersion: '2.0.0', pullOutput: '' });
      await runPeriodicCheck();

      mockedHelper.listWatchtowerContainers.mockResolvedValue([{ ...plex, installedVersion: '2.0.0' }]);
      plexUpdate.resolve(true);
      await flush();

      expect(lastPublishedState('plex')).toEqual(expect.objectContaining({
        installed_version: '2.0.0',
        latest_version: '2.0.0',
        in_progress: false,
      }));
    });

    it('keeps the entity of a container that is mid-recreate during the check', async () => {
      await startWithContainers([plex, sonarr]);
      const plexUpdate = defer<boolean>();
      mockedHelper.updateContainer.mockImplementationOnce(() => plexUpdate.promise);
      mockMqttClient.simulateMessage(installTopic('plex'), 'INSTALL');
      await flush();

      // Mid-recreate, plex is briefly absent from `docker ps`.
      mockedHelper.listWatchtowerContainers.mockResolvedValue([sonarr]);
      await runPeriodicCheck();

      expect(entityRemoved('plex')).toBe(false);

      mockedHelper.listWatchtowerContainers.mockResolvedValue([plex, sonarr]);
      plexUpdate.resolve(true);
      await flush();

      expect(lastPublishedState('plex')).toEqual(expect.objectContaining({ in_progress: false }));
    });

    it('keeps it even when the recreate ends before the check does', async () => {
      await startWithContainers([plex, sonarr]);
      const plexUpdate = defer<boolean>();
      mockedHelper.updateContainer.mockImplementationOnce(() => plexUpdate.promise);
      mockMqttClient.simulateMessage(installTopic('plex'), 'INSTALL');
      await flush();

      // The check lists the containers while plex is mid-recreate, then
      // pulls sonarr's image, slowly...
      const sonarrPull = defer<UpdateCheckResult>();
      mockedHelper.listWatchtowerContainers.mockResolvedValueOnce([sonarr]);
      mockedHelper.checkContainerUpdate.mockImplementationOnce(() => sonarrPull.promise);
      const check = runPeriodicCheck();
      await flush();

      // ...and plex's install is over by the time that pull ends.
      mockedHelper.listWatchtowerContainers.mockResolvedValue([plex, sonarr]);
      plexUpdate.resolve(true);
      await flush();
      sonarrPull.resolve({ hasUpdate: false, newVersion: '1.0.0', pullOutput: '' });
      await check;

      expect(entityRemoved('plex')).toBe(false);
    });

    it('keeps every entity while another host maintenance operation, such as an apt upgrade, runs', async () => {
      await startWithContainers([plex, sonarr]);
      // Stands in for an apt upgrade whose compose recreate has plex down.
      const upgrade = defer<void>();
      const upgradeRun = runExclusive(() => upgrade.promise);
      mockedHelper.listWatchtowerContainers.mockResolvedValue([sonarr]);

      await runPeriodicCheck();

      expect(entityRemoved('plex')).toBe(false);
      upgrade.resolve();
      await upgradeRun;
    });

    it('still removes the entity of a container gone while nothing was queued or running', async () => {
      await startWithContainers([plex, sonarr]);
      mockedHelper.listWatchtowerContainers.mockResolvedValue([sonarr]);

      await runPeriodicCheck();

      expect(entityRemoved('plex')).toBe(true);
    });
  });
});
