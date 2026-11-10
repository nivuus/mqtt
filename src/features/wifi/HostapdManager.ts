// src/features/wifi/HostapdManager.ts
//
// Home Assistant control of the hostapd networks: one entity set per SSID, an
// "add network" form, and a reload button. File edits live in hostapdConfigText,
// file I/O and hostapd control in hostapdService.

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient, FeatureConfig } from '../../core/types';
import logger from '../../utils/logger';
import { SecurityType, isSecurityType, validateNetworkConfig } from './securityProfiles';
import {
  NetworkConfig, parseNetworkConfig, listBridges, addBss, updateNetwork, removeNetwork,
} from './hostapdConfigText';
import { ApplyMode, readHostapdConfig, writeHostapdConfig, applyToHostapd } from './hostapdService';
import { EntitySpec, globalEntities, networkEntities, bandsLabel } from './hostapdEntities';

interface HostapdManagerFeatureConfig extends FeatureConfig {
  config_paths?: string[];
}

interface NewNetworkForm {
  ssid: string;
  password: string;
  securityType: string;
  bridge: string;
}

export class HostapdManager extends BaseFeature {
  protected featureConfig: HostapdManagerFeatureConfig;
  private networks: Map<string, NetworkConfig> = new Map();
  private bridges: string[] = [];
  private pendingChanges: Map<string, Partial<NetworkConfig>> = new Map();
  private form: NewNetworkForm = { ssid: '', password: '', securityType: 'WPA2/WPA3-Mixed', bridge: '' };
  private networkIdCounter = 0;
  private ssidToId: Map<string, number> = new Map();
  private discovered: Set<string> = new Set();

  constructor(mqttClient: MqttClient, featureName: string = 'hostapd_manager') {
    super(mqttClient, featureName);
    this.featureConfig = this.agentConfig.features[featureName] as HostapdManagerFeatureConfig ||
                         { enabled: true, update_interval_seconds: 3600, config_paths: [] };
    if (!Array.isArray(this.featureConfig.config_paths)) {
      this.featureConfig.config_paths = [];
    }
  }

  private get configPaths(): string[] {
    return this.featureConfig.config_paths ?? [];
  }

  protected async setup(): Promise<void> {
    await this.mqttClient.subscribe(this.prefixTopic(`${this.featureName}/command/#`));
    await this.mqttClient.subscribe(this.prefixTopic(`${this.featureName}/+/set`));
    await this.mqttClient.subscribe(this.prefixTopic(`${this.featureName}/+/+/set`));
    await this.mqttClient.subscribe(this.prefixTopic(`${this.featureName}/+/command/+`));
    this.listenToMessages(this.handleMqttMessage.bind(this));
  }

  private async report(message: string): Promise<void> {
    await this.publishState(`${this.featureName}/last_action/state`, message, true);
  }

  private async handleMqttMessage(topic: string, payload: Buffer): Promise<void> {
    const prefix = this.prefixTopic(`${this.featureName}/`);
    if (!topic.startsWith(prefix)) return;
    const message = payload.toString();
    const parts = topic.substring(prefix.length).split('/');

    const formFields: Record<string, keyof NewNetworkForm> = {
      new_ssid_input: 'ssid', new_password_input: 'password',
      new_security_select: 'securityType', new_bridge_select: 'bridge',
    };
    if (parts.length === 2 && parts[1] === 'set' && formFields[parts[0]]) {
      this.form[formFields[parts[0]]] = message;
      if (parts[0].endsWith('_input')) await this.publishTextState(`${this.featureName}/${parts[0]}/state`, message);
      else await this.publishState(`${this.featureName}/${parts[0]}/state`, message, true);
      return;
    }
    if (parts[0] === 'command') {
      if (parts[1] === 'add_hotspot' && message === 'ADD_HOTSPOT') await this.addNetwork();
      if (parts[1] === 'reload_hostapd' && message === 'RELOAD_HOSTAPD') await this.applyAndReport('reload', 'Reload');
      return;
    }
    if (parts.length < 3 || !parts[0].startsWith('network_')) return;
    const id = parseInt(parts[0].substring('network_'.length), 10);
    const ssid = this.getSsidFromId(id);
    if (!ssid || !this.networks.has(ssid)) return;

    if (parts[2] === 'set') {
      const pending = this.pendingChanges.get(ssid) ?? {};
      if (parts[1] === 'name') pending.ssid = message;
      if (parts[1] === 'password') pending.password = message;
      if (parts[1] === 'security' && isSecurityType(message)) pending.securityType = message;
      this.pendingChanges.set(ssid, pending);
      const topicPath = `${this.featureName}/network_${id}/${parts[1]}/state`;
      if (parts[1] === 'security') await this.publishState(topicPath, message, true);
      else await this.publishTextState(topicPath, message);
    } else if (parts[1] === 'command' && parts[2] === 'apply' && message === 'APPLY') {
      await this.applyNetworkChanges(ssid);
    } else if (parts[1] === 'command' && parts[2] === 'delete' && message === 'DELETE') {
      await this.deleteNetwork(ssid);
    }
  }

  /** Rewrite every file with `edit`, then hand the change to hostapd. False if nothing was written. */
  private async editFiles(files: string[], edit: (content: string, file: string) => string,
                          mode: ApplyMode, done: string): Promise<boolean> {
    try {
      // Every edit is computed before anything is written: one bad file leaves all untouched.
      const updated = await Promise.all(files.map(async (file) => [file, edit(await readHostapdConfig(file), file)] as const));
      for (const [file, content] of updated) await writeHostapdConfig(file, content);
    } catch (error: any) {
      logger.error(`hostapd configuration change failed: ${error.message}`);
      await this.report(`Error: ${error.message}`);
      return false;
    }
    await this.applyAndReport(mode, done);
    return true;
  }

  private async applyAndReport(mode: ApplyMode, done: string): Promise<void> {
    await this.report(mode === 'restart' ? `${done}: restarting hostapd (Wi-Fi off ~15 s)...` : `${done}: reloading hostapd...`);
    const result = await applyToHostapd(mode);
    await this.report(result.ok ? `${done}: done (${result.detail})` : `${done}: saved but NOT applied: ${result.detail}`);
    await this.update();
  }

  private async addNetwork(): Promise<void> {
    const { ssid, password, securityType } = this.form;
    const bridge = this.form.bridge || this.defaultBridge();
    const invalid = validateNetworkConfig(ssid, password, securityType);
    if (invalid) return this.report(`Validation error: ${invalid}`);
    if (!this.bridges.includes(bridge)) return this.report(`Error: unknown bridge ${bridge}`);
    if (this.networks.has(ssid)) return this.report(`Error: network ${ssid} already exists`);
    if (this.configPaths.length === 0) return this.report('Error: no hostapd config paths configured');

    const network = { ssid, password, securityType: securityType as SecurityType, bridge };
    if (!await this.editFiles(this.configPaths, (content) => addBss(content, network).content, 'restart', `Add ${ssid} on ${bridge}`)) return;
    this.form = { ...this.form, ssid: '', password: '' };
    await this.publishTextState(`${this.featureName}/new_ssid_input/state`, '');
    await this.publishTextState(`${this.featureName}/new_password_input/state`, '');
  }

  private async applyNetworkChanges(ssid: string): Promise<void> {
    const network = this.networks.get(ssid)!;
    const pending = this.pendingChanges.get(ssid);
    if (!pending || Object.keys(pending).length === 0) return this.report(`No changes to apply for ${ssid}`);
    const newSsid = pending.ssid ?? network.ssid;
    const password = pending.password ?? network.password;
    const securityType = pending.securityType ?? network.securityType;
    const invalid = validateNetworkConfig(newSsid, password, securityType);
    if (invalid) return this.report(`Validation error: ${invalid}`);
    if (newSsid !== ssid && this.networks.has(newSsid)) return this.report(`Error: network ${newSsid} already exists`);

    this.pendingChanges.delete(ssid);
    if (newSsid !== ssid) {
      // Keep the entity id: the HA entities follow the network through a rename.
      this.ssidToId.set(newSsid, this.ssidToId.get(ssid)!);
      this.ssidToId.delete(ssid);
      this.discovered.delete(ssid);
      this.discovered.add(newSsid);
    }
    await this.editFiles(network.configFiles,
      (content) => updateNetwork(content, ssid, newSsid, password, securityType), 'reload', `Update ${ssid}`);
  }

  private async deleteNetwork(ssid: string): Promise<void> {
    const network = this.networks.get(ssid)!;
    if (network.isPrimary) {
      return this.report(`Error: ${ssid} is a radio's main network and cannot be deleted (rename it instead)`);
    }
    await this.editFiles(network.configFiles, (content) => removeNetwork(content, ssid), 'restart', `Delete ${ssid}`);
    this.pendingChanges.delete(ssid);
  }

  /** A bridge no radio's main network uses (a guest network), else the first one. */
  private defaultBridge(): string {
    const mainBridges = [...this.networks.values()].filter((n) => n.isPrimary).map((n) => n.bridge);
    return this.bridges.find((b) => !mainBridges.includes(b)) ?? this.bridges[0] ?? '';
  }

  private async loadNetworks(): Promise<boolean> {
    const networks = new Map<string, NetworkConfig>();
    const bridges = new Set<string>();
    let failed = false;
    for (const path of this.configPaths) {
      try {
        const content = await readHostapdConfig(path);
        listBridges(content).forEach((b) => bridges.add(b));
        parseNetworkConfig(content, path).forEach((network, ssid) => {
          const existing = networks.get(ssid);
          if (!existing) return networks.set(ssid, network);
          existing.configFiles.push(...network.configFiles.filter((f) => !existing.configFiles.includes(f)));
          existing.bssInterfaces = [...(existing.bssInterfaces ?? []), ...(network.bssInterfaces ?? [])];
          existing.isPrimary = existing.isPrimary || network.isPrimary;
        });
      } catch (error: any) {
        logger.error(`Error reading hostapd config ${path}: ${error.message}`);
        failed = true;
      }
    }
    this.networks = networks;
    this.bridges = [...bridges];
    return !failed;
  }

  private async publishSpecs(specs: EntitySpec[]): Promise<void> {
    for (const spec of specs) await this.publishEntityDiscovery(spec.component, spec.objectId, spec.payload as any);
  }

  protected async publishDiscovery(): Promise<void> {
    await this.loadNetworks();
    const topic = (path: string) => this.prefixTopic(path);
    await this.publishSpecs(globalEntities(this.featureName, topic, this.bridges));
    this.form.bridge = this.defaultBridge();
    await this.report('Ready');
    await this.publishTextState(`${this.featureName}/new_ssid_input/state`, '');
    await this.publishTextState(`${this.featureName}/new_password_input/state`, '');
    await this.publishState(`${this.featureName}/new_security_select/state`, this.form.securityType, true);
    await this.publishState(`${this.featureName}/new_bridge_select/state`, this.form.bridge, true);
    await this.publishNetworkStates();
  }

  protected async update(): Promise<void> {
    const ok = await this.loadNetworks();
    if (!ok && this.networks.size === 0) {
      await this.publishState(`${this.featureName}/ssids_count/state`, 'Error', true);
      await this.publishAttributes(`${this.featureName}/ssids_list/attributes`, { error: 'Failed to read one or more config files.', list: [] }, true);
      return;
    }
    const list = [...this.networks.values()].map((n) => ({
      name: n.ssid, sources: n.configFiles.map((f) => f.split('/').pop() || f),
      security: n.securityType, bands: bandsLabel(n.configFiles), bridge: n.bridge ?? '',
    }));
    await this.publishState(`${this.featureName}/ssids_count/state`, this.networks.size, true);
    await this.publishAttributes(`${this.featureName}/ssids_list/attributes`, { list }, true);
    await this.publishNetworkStates();
  }

  private async publishNetworkStates(): Promise<void> {
    for (const [ssid, network] of this.networks) {
      const id = this.getNetworkId(ssid);
      if (!this.discovered.has(ssid)) {
        await this.publishSpecs(networkEntities(this.featureName, (path) => this.prefixTopic(path), id, ssid));
        this.discovered.add(ssid);
      }
      const state = (path: string, value: string) => this.publishState(`${this.featureName}/network_${id}/${path}/state`, value, true);
      await this.publishTextState(`${this.featureName}/network_${id}/name/state`, network.ssid);
      await this.publishTextState(`${this.featureName}/network_${id}/password/state`, network.password);
      await state('security', network.securityType);
      await state('status', `Active (${bandsLabel(network.configFiles)})`);
    }
  }

  private getNetworkId(ssid: string): number {
    if (!this.ssidToId.has(ssid)) this.ssidToId.set(ssid, ++this.networkIdCounter);
    return this.ssidToId.get(ssid)!;
  }

  private getSsidFromId(networkId: number): string | undefined {
    for (const [ssid, id] of this.ssidToId) if (id === networkId) return ssid;
    return undefined;
  }
}
