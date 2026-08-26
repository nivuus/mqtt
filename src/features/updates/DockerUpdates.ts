// src/features/updates/DockerUpdates.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient, FeatureConfig } from '../../core/types';
import logger from '../../utils/logger';
import {
  ContainerInfo, listWatchtowerContainers, checkContainerUpdate,
  fetchChangelog, updateContainer,
} from './DockerHelper';

interface DockerUpdatesConfig extends FeatureConfig {
  check_interval_hours?: number;
  exclude_containers?: string[];
}

interface ContainerState {
  container: ContainerInfo;
  hasUpdate: boolean;
  newVersion: string;
  releaseSummary: string;
  releaseUrl: string;
  installing: boolean;
}

const DEFAULT_CHECK_INTERVAL_HOURS = 12;

export class DockerUpdates extends BaseFeature {
  protected featureConfig: DockerUpdatesConfig;
  private containers: Map<string, ContainerState> = new Map();
  private knownServiceNames: Set<string> = new Set();
  private lastCheckTimestamp: number = 0;
  private boundMessageHandler: (topic: string, payload: Buffer) => Promise<void>;

  constructor(mqttClient: MqttClient, featureName: string = 'docker_updates') {
    super(mqttClient, featureName);
    this.featureConfig = this.agentConfig.features[featureName] as DockerUpdatesConfig ||
      { enabled: true, check_interval_hours: DEFAULT_CHECK_INTERVAL_HOURS };

    const checkIntervalSeconds = (this.featureConfig.check_interval_hours || DEFAULT_CHECK_INTERVAL_HOURS) * 3600;
    if (!this.featureConfig.update_interval_seconds || this.featureConfig.update_interval_seconds > checkIntervalSeconds) {
      this.featureConfig.update_interval_seconds = checkIntervalSeconds;
    }

    this.boundMessageHandler = this.handleMessage.bind(this);
  }

  protected async publishDiscovery(): Promise<void> {
    // Dynamic — discovery is published per container in update()
  }

  protected async setup(): Promise<void> {
    const commandTopic = this.prefixTopic(`${this.featureName}/+/command`);
    await this.mqttClient.subscribe(commandTopic);
    this.mqttClient.on('message', this.boundMessageHandler);
  }

  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    const prefix = this.prefixTopic(`${this.featureName}/`);
    if (!topic.startsWith(prefix) || !topic.endsWith('/command')) return;

    const message = payload.toString();
    if (message !== 'INSTALL') return;

    // Extract sanitized service name from topic
    const serviceId = topic.slice(prefix.length, -'/command'.length);
    const state = this.findStateByServiceId(serviceId);
    if (!state) {
      logger.warn(`Install command for unknown container: ${serviceId}`);
      return;
    }

    logger.info(`Docker install command received for ${state.container.name}`);
    await this.installContainer(state);
  }

  private findStateByServiceId(serviceId: string): ContainerState | undefined {
    for (const state of this.containers.values()) {
      if (this.sanitize(state.container.serviceName) === serviceId) return state;
    }
    return undefined;
  }

  protected async update(): Promise<void> {
    const now = Date.now();
    const intervalMs = (this.featureConfig.check_interval_hours || DEFAULT_CHECK_INTERVAL_HOURS) * 3600 * 1000;

    if (now - this.lastCheckTimestamp > intervalMs) {
      await this.checkAllContainers();
    } else {
      await this.publishAllStates();
    }
  }

  private async checkAllContainers(): Promise<void> {
    logger.info('Checking Docker containers for updates...');
    this.lastCheckTimestamp = Date.now();

    const allContainers = await listWatchtowerContainers();
    const excludeList = this.featureConfig.exclude_containers || [];
    const containers = allContainers.filter(c => !excludeList.includes(c.serviceName));

    logger.info(`Found ${containers.length} watchtower-enabled containers`);

    const currentNames = new Set<string>();

    for (const container of containers) {
      const serviceId = this.sanitize(container.serviceName);
      currentNames.add(serviceId);

      // Publish discovery if this is a new container
      if (!this.knownServiceNames.has(serviceId)) {
        await this.publishContainerDiscovery(container);
        this.knownServiceNames.add(serviceId);
      }

      // Check for update
      const checkResult = await checkContainerUpdate(container);
      let releaseSummary = '';
      let releaseUrl = '';

      if (checkResult.hasUpdate && container.sourceUrl) {
        const changelog = await fetchChangelog(container.sourceUrl);
        releaseSummary = changelog.releaseSummary;
        releaseUrl = changelog.releaseUrl;
      }

      this.containers.set(serviceId, {
        container,
        hasUpdate: checkResult.hasUpdate,
        newVersion: checkResult.newVersion,
        releaseSummary,
        releaseUrl,
        installing: false,
      });

      await this.publishContainerState(serviceId);
    }

    // Remove entities for containers that no longer exist
    await this.removeStaleEntities(currentNames);
  }

  private async publishContainerDiscovery(container: ContainerInfo): Promise<void> {
    const serviceId = this.sanitize(container.serviceName);
    const friendlyName = this.formatName(container.serviceName);

    await this.publishEntityDiscovery('update', serviceId, {
      name: `Docker ${friendlyName}`,
      state_topic: `${this.featureName}/${serviceId}/state`,
      command_topic: `${this.featureName}/${serviceId}/command`,
      payload_install: 'INSTALL',
      entity_category: 'config',
    });
  }

  private async publishContainerState(serviceId: string): Promise<void> {
    const state = this.containers.get(serviceId);
    if (!state) return;

    const payload = {
      installed_version: state.container.installedVersion,
      latest_version: state.hasUpdate ? state.newVersion : state.container.installedVersion,
      title: this.formatName(state.container.serviceName),
      release_summary: state.releaseSummary,
      release_url: state.releaseUrl || undefined,
      in_progress: state.installing,
      entity_picture: `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${state.container.serviceName}.png`,
    };

    const fullTopic = this.prefixTopic(`${this.featureName}/${serviceId}/state`);
    await this.mqttClient.publish(fullTopic, JSON.stringify(payload), { retain: true, qos: 1 });
  }

  private async publishAllStates(): Promise<void> {
    for (const serviceId of this.containers.keys()) {
      await this.publishContainerState(serviceId);
    }
  }

  private async installContainer(state: ContainerState): Promise<void> {
    if (state.installing) return;

    const serviceId = this.sanitize(state.container.serviceName);
    state.installing = true;
    await this.publishContainerState(serviceId);

    try {
      const success = await updateContainer(state.container);
      if (success) {
        // Re-inspect the container to get the new version
        const containers = await listWatchtowerContainers();
        const updated = containers.find(c => c.serviceName === state.container.serviceName);
        if (updated) {
          state.container = updated;
          state.hasUpdate = false;
          state.newVersion = updated.installedVersion;
        }
      }
    } catch (error: any) {
      logger.error(`Error updating ${state.container.name}:`, error.message);
    }

    state.installing = false;
    await this.publishContainerState(serviceId);
  }

  private async removeStaleEntities(currentNames: Set<string>): Promise<void> {
    for (const serviceId of this.knownServiceNames) {
      if (!currentNames.has(serviceId)) {
        // Publish empty config to remove the entity from HA
        const uniqueId = `${this.deviceInfo.identifiers[0]}_${this.featureName}_${serviceId}`;
        const discoveryTopic = `homeassistant/update/${this.deviceInfo.identifiers[0]}/${uniqueId}/config`;
        await this.mqttClient.publish(discoveryTopic, '', { retain: true, qos: 1 });
        this.containers.delete(serviceId);
        this.knownServiceNames.delete(serviceId);
        logger.info(`Removed stale Docker entity: ${serviceId}`);
      }
    }
  }

  private sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  }

  private formatName(serviceName: string): string {
    return serviceName
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  protected async cleanup(): Promise<void> {
    this.mqttClient.removeListener('message', this.boundMessageHandler);
  }
}
