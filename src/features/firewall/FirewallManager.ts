// src/features/firewall/FirewallManager.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient, FeatureConfig } from '../../core/types';
import { execute_argv } from '../../utils/exec';
import { Validators, rejectInvalid } from '../../utils/validators';
import logger from '../../utils/logger';
import { zonePortForwards, zoneServices, zonePorts, zoneMasquerade, parseActiveZones } from './firewallQueries';
import { EntitySpec, interfaceZoneSensor, interfaceZoneSelect, zoneEntities } from './firewallEntities';
import { controlEntities, RETIRED_FORM_ENTITIES } from './firewallFormEntities';
import { parseRuleCommand, applyRule, moveInterface, RuleResult } from './firewallRules';

interface FirewallManagerFeatureConfig extends FeatureConfig {
  // Future config options for firewall management
}

export class FirewallManager extends BaseFeature {
  protected featureConfig: FirewallManagerFeatureConfig;
  private readonly relevantInterfacePatterns = /^(eth|enp|wlp|wlo|ppp)/i; // From project requirements
  private availableZones: string[] = [];

  // Interface to zone mapping
  private interfaceZoneMap: Map<string, string> = new Map();

  constructor(mqttClient: MqttClient, featureName: string = 'firewalld_manager') {
    super(mqttClient, featureName);
    this.featureConfig = this.agentConfig.features[featureName] as FirewallManagerFeatureConfig ||
                         { enabled: true, update_interval_seconds: 300 }; // Default to enabled
  }


  protected async setup(): Promise<void> {
    // rule/set and the interfaces' <iface>_zone_select/set
    const allInputsTopic = this.prefixTopic(`${this.featureName}/+/set`);
    await this.mqttClient.subscribe(allInputsTopic);

    this.listenToMessages(this.handleMqttMessage.bind(this));
  }

  private async handleMqttMessage(topic: string, payload: Buffer): Promise<void> {
    const message = payload.toString();
    if (topic === this.prefixTopic(`${this.featureName}/rule/set`)) {
      await this.handleRuleCommand(message);
      return;
    }
    // An interface's zone select: <iface>_zone_select/set
    const topicPrefix = this.prefixTopic(`${this.featureName}/`);
    const match = topic.startsWith(topicPrefix) && topic.substring(topicPrefix.length).match(/^(.+)_zone_select\/set$/);
    if (match) await this.handleInterfaceZoneChange(match[1], message);
  }

  /** Adds or removes one service, port or forward in one zone (see firewallRules.ts). */
  private async handleRuleCommand(message: string): Promise<void> {
    const parsed = parseRuleCommand(message, this.availableZones);
    let result: RuleResult;
    if ('error' in parsed) {
      rejectInvalid('rule', parsed.error, this.featureName);
      result = { id: parsed.id, ok: false, failed: 'invalid', detail: parsed.error };
    } else {
      logger.info(`Firewall rule: ${parsed.op} ${JSON.stringify(parsed.rule)} in zone ${parsed.zone}`);
      result = await applyRule(parsed);
      if (!result.ok) logger.error(`Firewall rule change failed (${result.failed}): ${result.detail}`);
      await this.update();
    }
    await this.publishLastAction(result);
  }

  /** State: a short code; attributes: the command topic and the structured result. */
  private async publishLastAction(result?: RuleResult): Promise<void> {
    const state = !result ? 'ready' : result.ok ? 'ok' : 'error';
    await this.publishState(`${this.featureName}/last_action/state`, state, true);
    await this.publishAttributes(`${this.featureName}/last_action/attributes`, {
      command_topic: this.prefixTopic(`${this.featureName}/rule/set`),
      result: result ?? null,
    }, true);
  }

  private async handleInterfaceZoneChange(interfaceName: string, newZone: string): Promise<void> {
    try {
      const oldZone = this.interfaceZoneMap.get(interfaceName);
      if (!oldZone) {
        rejectInvalid('interface', interfaceName, this.featureName);
        return;
      }

      if (oldZone === newZone) {
        return; // No change
      }

      if (!Validators.isInterface(interfaceName) || !Validators.isZone(oldZone) || !Validators.isZone(newZone)) {
        rejectInvalid('interface/zone', `${interfaceName} ${oldZone}->${newZone}`, this.featureName);
        return;
      }

      logger.info(`Moving interface ${interfaceName} from ${oldZone} to ${newZone}`);

      const outcome = await moveInterface(interfaceName, newZone);
      if (!outcome.ok) {
        logger.error(`Moving ${interfaceName} to ${newZone} failed (${outcome.failed}): ${outcome.detail}`);
        await this.publishState(`${this.featureName}/${interfaceName}_zone_select/state`, oldZone, true);
        await this.publishLastAction({ id: '', ...outcome });
        return;
      }

      // Update internal mapping
      this.interfaceZoneMap.set(interfaceName, newZone);

      // Update state
      await this.publishState(`${this.featureName}/${interfaceName}_zone_select/state`, newZone, true);
      await this.publishLastAction({ id: '', ...outcome });
    } catch (error: any) {
      logger.error(`Error changing interface zone:`, error);
    }
  }

  private async publishSpecs(specs: EntitySpec[]): Promise<void> {
    for (const spec of specs) await this.publishEntityDiscovery(spec.component, spec.objectId, spec.payload as never);
  }

  protected async publishDiscovery(): Promise<void> {
    // Entities follow firewalld: one zone select per interface, one set of
    // rule sensors per active zone. Publication order is pinned by
    // __tests__/FirewallManager.publications.test.ts.
    try {
      const activeZonesOutput = await execute_argv('firewall-cmd', ['--get-active-zones']);
      const zoneInterfaceMap = parseActiveZones(activeZonesOutput.stdout);

      // Get all available zones for management
      const zonesOutput = await execute_argv('firewall-cmd', ['--get-zones']);
      this.availableZones = zonesOutput.stdout.trim().split(/\s+/).filter(zone => zone.length > 0);

      const allInterfaces = new Set<string>();
      zoneInterfaceMap.forEach(interfaces => interfaces.forEach(iface => allInterfaces.add(iface)));
      const topic = (path: string) => this.prefixTopic(path);
      const feature = this.featureName;

      for (const iface of allInterfaces) {
        if (this.relevantInterfacePatterns.test(iface)) await this.publishSpecs(interfaceZoneSensor(feature, topic, iface));
      }

      await this.publishSpecs(controlEntities(feature, topic));

      // A zone select for each relevant interface, bridges included.
      for (const iface of allInterfaces) {
        const isRelevant = this.relevantInterfacePatterns.test(iface) || iface.includes('Bridge');
        if (isRelevant) {
          const currentZone = Array.from(zoneInterfaceMap.entries()).find(([_, interfaces]) => interfaces.includes(iface))?.[0] || 'public';
          this.interfaceZoneMap.set(iface, currentZone);
          await this.publishSpecs(interfaceZoneSelect(feature, topic, iface, this.availableZones));
          await this.publishState(`${this.featureName}/${iface}_zone_select/state`, currentZone, true);
        }
      }


      for (const zone of zoneInterfaceMap.keys()) {
        await this.publishSpecs(zoneEntities(feature, topic, zone));
      }

      // The global port and forward forms gave way to per-zone editing (rule/set).
      for (const [component, objectId] of RETIRED_FORM_ENTITIES) await this.removeEntityDiscovery(component, objectId);

      await this.publishLastAction();

    } catch (error) {
      logger.error(`Error during firewall discovery for ${this.featureName}:`, error);
    }
  }

  protected async update(): Promise<void> {
    try {
      const activeZonesOutput = await execute_argv('firewall-cmd', ['--get-active-zones']);
      const zoneInterfaceMap = parseActiveZones(activeZonesOutput.stdout);

      const interfaceToZone: { [iface: string]: string } = {};
      const activeZoneDetails: { [zone: string]: string[] } = {};

      zoneInterfaceMap.forEach((interfaces, zone) => {
        activeZoneDetails[zone] = interfaces;
        interfaces.forEach(iface => {
          if (this.relevantInterfacePatterns.test(iface)) {
            interfaceToZone[iface] = zone;
          }
        });
      });

      for (const iface in interfaceToZone) {
        await this.publishState(`${this.featureName}/${iface}/zone/state`, interfaceToZone[iface], true);
        // Update internal mapping
        this.interfaceZoneMap.set(iface, interfaceToZone[iface]);
      }

      // Publish summary sensor
      const zoneCount = Object.keys(activeZoneDetails).length;
      await this.publishState(`${this.featureName}/active_zones/state`, `${zoneCount} active zone(s)`, true);
      await this.publishAttributes(`${this.featureName}/active_zones/attributes`, activeZoneDetails, true);

      // Publish zone details (port forwards, services, ports, masquerade) for each active zone
      for (const zone of zoneInterfaceMap.keys()) {
        // Port forwards
        const forwards = await zonePortForwards(zone);
        await this.publishState(`${this.featureName}/${zone}/port_forwards/state`, forwards.length.toString(), true);
        await this.publishAttributes(`${this.featureName}/${zone}/port_forwards/attributes`, { forwards }, true);

        // Services
        const services = await zoneServices(zone);
        await this.publishState(`${this.featureName}/${zone}/services/state`, services.length.toString(), true);
        await this.publishAttributes(`${this.featureName}/${zone}/services/attributes`, { services }, true);

        // Ports
        const ports = await zonePorts(zone);
        await this.publishState(`${this.featureName}/${zone}/ports/state`, ports.length.toString(), true);
        await this.publishAttributes(`${this.featureName}/${zone}/ports/attributes`, { ports }, true);

        // Masquerade
        const masquerade = await zoneMasquerade(zone);
        await this.publishState(`${this.featureName}/${zone}/masquerade/state`, masquerade ? 'ON' : 'OFF', true);
      }

    } catch (error) {
      logger.error(`Error updating firewall status for ${this.featureName}:`, error);
    }
  }
}
