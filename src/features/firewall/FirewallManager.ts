// src/features/firewall/FirewallManager.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient, FeatureConfig } from '../../core/types';
import { execute_argv } from '../../utils/exec';
import { Validators, rejectInvalid } from '../../utils/validators';
import logger from '../../utils/logger';
import { zonePortForwards, zoneServices, zonePorts, zoneMasquerade, parseActiveZones } from './firewallQueries';
import { EntitySpec, interfaceZoneSensor, interfaceZoneSelect, zoneEntities } from './firewallEntities';
import { controlEntities, forwardEntities } from './firewallFormEntities';

interface FirewallManagerFeatureConfig extends FeatureConfig {
  // Future config options for firewall management
}

export class FirewallManager extends BaseFeature {
  protected featureConfig: FirewallManagerFeatureConfig;
  private readonly relevantInterfacePatterns = /^(eth|enp|wlp|wlo|ppp)/i; // From project requirements
  private availableZones: string[] = [];

  // State storage for user inputs
  private currentPort: string = '';
  private currentProtocol: string = 'tcp';
  private currentZone: string = 'public';
  private currentService: string = '';

  // State storage for port forward inputs
  private currentForwardPort: string = '';
  private currentForwardToAddr: string = '';
  private currentForwardToPort: string = '';
  private currentForwardProtocol: string = 'tcp';
  private currentForwardZone: string = 'public';

  // Interface to zone mapping
  private interfaceZoneMap: Map<string, string> = new Map();

  constructor(mqttClient: MqttClient, featureName: string = 'firewalld_manager') {
    super(mqttClient, featureName);
    this.featureConfig = this.agentConfig.features[featureName] as FirewallManagerFeatureConfig ||
                         { enabled: true, update_interval_seconds: 300 }; // Default to enabled
  }


  protected async setup(): Promise<void> {
    // Subscribe to command topics for firewall management
    const commandTopic = this.prefixTopic(`${this.featureName}/command/#`);
    await this.mqttClient.subscribe(commandTopic);

    // Subscribe to all input and select topics with wildcard
    const allInputsTopic = this.prefixTopic(`${this.featureName}/+/set`);
    await this.mqttClient.subscribe(allInputsTopic);

    this.listenToMessages(this.handleMqttMessage.bind(this));
  }

  private async handleMqttMessage(topic: string, payload: Buffer): Promise<void> {
    const message = payload.toString();

    // Handle input states for port/service management
    if (topic === this.prefixTopic(`${this.featureName}/port_input/set`)) {
      this.currentPort = message;
      await this.publishTextState(`${this.featureName}/port_input/state`, message);
    } else if (topic === this.prefixTopic(`${this.featureName}/protocol_select/set`)) {
      this.currentProtocol = message;
      await this.publishState(`${this.featureName}/protocol_select/state`, message, true);
    } else if (topic === this.prefixTopic(`${this.featureName}/zone_select/set`)) {
      this.currentZone = message;
      await this.publishState(`${this.featureName}/zone_select/state`, message, true);
    } else if (topic === this.prefixTopic(`${this.featureName}/service_input/set`)) {
      this.currentService = message;
      await this.publishTextState(`${this.featureName}/service_input/state`, message);
    }

    // Handle input states for port forward management
    else if (topic === this.prefixTopic(`${this.featureName}/forward_port_input/set`)) {
      this.currentForwardPort = message;
      await this.publishTextState(`${this.featureName}/forward_port_input/state`, message);
    } else if (topic === this.prefixTopic(`${this.featureName}/forward_toaddr_input/set`)) {
      this.currentForwardToAddr = message;
      await this.publishTextState(`${this.featureName}/forward_toaddr_input/state`, message);
    } else if (topic === this.prefixTopic(`${this.featureName}/forward_toport_input/set`)) {
      this.currentForwardToPort = message;
      await this.publishTextState(`${this.featureName}/forward_toport_input/state`, message);
    } else if (topic === this.prefixTopic(`${this.featureName}/forward_protocol_select/set`)) {
      this.currentForwardProtocol = message;
      await this.publishState(`${this.featureName}/forward_protocol_select/state`, message, true);
    } else if (topic === this.prefixTopic(`${this.featureName}/forward_zone_select/set`)) {
      this.currentForwardZone = message;
      await this.publishState(`${this.featureName}/forward_zone_select/state`, message, true);
    }

    // Handle interface zone changes - check if topic matches pattern interface_XXXX_zone_select/set
    else if (topic.includes('_zone_select/set')) {
      const topicPrefix = this.prefixTopic(`${this.featureName}/`);
      if (topic.startsWith(topicPrefix)) {
        const relativeTopic = topic.substring(topicPrefix.length);
        const match = relativeTopic.match(/^(.+)_zone_select\/set$/);
        if (match) {
          const interfaceName = match[1];
          const newZone = message;
          await this.handleInterfaceZoneChange(interfaceName, newZone);
        }
      }
    }

    // Handle action commands
    else if (topic === this.prefixTopic(`${this.featureName}/command/add_port`) && message === 'ADD_PORT') {
      await this.handleAddPortAction();
    } else if (topic === this.prefixTopic(`${this.featureName}/command/remove_port`) && message === 'REMOVE_PORT') {
      await this.handleRemovePortAction();
    } else if (topic === this.prefixTopic(`${this.featureName}/command/add_service`) && message === 'ADD_SERVICE') {
      await this.handleAddServiceAction();
    } else if (topic === this.prefixTopic(`${this.featureName}/command/remove_service`) && message === 'REMOVE_SERVICE') {
      await this.handleRemoveServiceAction();
    } else if (topic === this.prefixTopic(`${this.featureName}/command/add_forward`) && message === 'ADD_FORWARD') {
      await this.handleAddForwardAction();
    } else if (topic === this.prefixTopic(`${this.featureName}/command/remove_forward`) && message === 'REMOVE_FORWARD') {
      await this.handleRemoveForwardAction();
    }
  }

  // Strict validation of MQTT-controlled inputs before any firewall mutation.
  private validatePortInputs(zone: string, port: string, protocol: string): boolean {
    if (!Validators.isZone(zone)) return rejectInvalid('zone', zone, this.featureName);
    if (!Validators.isPort(port)) return rejectInvalid('port', port, this.featureName);
    if (!Validators.isProtocol(protocol)) return rejectInvalid('protocol', protocol, this.featureName);
    return true;
  }

  private validateServiceInputs(zone: string, service: string): boolean {
    if (!Validators.isZone(zone)) return rejectInvalid('zone', zone, this.featureName);
    if (!Validators.isFirewallService(service)) return rejectInvalid('service', service, this.featureName);
    return true;
  }

  private validateForwardInputs(): boolean {
    if (!Validators.isZone(this.currentForwardZone)) return rejectInvalid('zone', this.currentForwardZone, this.featureName);
    if (!Validators.isPort(this.currentForwardPort)) return rejectInvalid('forward_port', this.currentForwardPort, this.featureName);
    if (!Validators.isProtocol(this.currentForwardProtocol)) return rejectInvalid('forward_protocol', this.currentForwardProtocol, this.featureName);
    if (!Validators.isPort(this.currentForwardToPort)) return rejectInvalid('forward_toport', this.currentForwardToPort, this.featureName);
    if (!Validators.isIPv4(this.currentForwardToAddr)) return rejectInvalid('forward_toaddr', this.currentForwardToAddr, this.featureName);
    return true;
  }

  private async getCurrentInputs(): Promise<{port: string, protocol: string, zone: string, service: string}> {
    return {
      port: this.currentPort,
      protocol: this.currentProtocol,
      zone: this.currentZone,
      service: this.currentService
    };
  }

  private async handleAddPortAction(): Promise<void> {
    try {
      const inputs = await this.getCurrentInputs();
      if (!inputs.port || !inputs.protocol || !inputs.zone) {
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Missing port, protocol or zone', false);
        return;
      }
      if (!this.validatePortInputs(inputs.zone, inputs.port, inputs.protocol)) {
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Invalid port, protocol or zone', false);
        return;
      }

      logger.info(`Adding port ${inputs.port}/${inputs.protocol} to zone ${inputs.zone}`);
      await execute_argv('firewall-cmd', [`--zone=${inputs.zone}`, `--add-port=${inputs.port}/${inputs.protocol}`, '--permanent']);
      await execute_argv('firewall-cmd', ['--reload']);
      await this.publishState(`${this.featureName}/last_action/state`, `Added port ${inputs.port}/${inputs.protocol} to ${inputs.zone}`, false);
    } catch (error: any) {
      logger.error(`Error adding port:`, error);
      await this.publishState(`${this.featureName}/last_action/state`, `Error: ${error.message}`, false);
    }
  }

  private async handleRemovePortAction(): Promise<void> {
    try {
      const inputs = await this.getCurrentInputs();
      if (!inputs.port || !inputs.protocol || !inputs.zone) {
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Missing port, protocol or zone', false);
        return;
      }
      if (!this.validatePortInputs(inputs.zone, inputs.port, inputs.protocol)) {
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Invalid port, protocol or zone', false);
        return;
      }

      logger.info(`Removing port ${inputs.port}/${inputs.protocol} from zone ${inputs.zone}`);
      await execute_argv('firewall-cmd', [`--zone=${inputs.zone}`, `--remove-port=${inputs.port}/${inputs.protocol}`, '--permanent']);
      await execute_argv('firewall-cmd', ['--reload']);
      await this.publishState(`${this.featureName}/last_action/state`, `Removed port ${inputs.port}/${inputs.protocol} from ${inputs.zone}`, false);
    } catch (error: any) {
      logger.error(`Error removing port:`, error);
      await this.publishState(`${this.featureName}/last_action/state`, `Error: ${error.message}`, false);
    }
  }

  private async handleAddServiceAction(): Promise<void> {
    try {
      const inputs = await this.getCurrentInputs();
      if (!inputs.service || !inputs.zone) {
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Missing service or zone', false);
        return;
      }
      if (!this.validateServiceInputs(inputs.zone, inputs.service)) {
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Invalid service or zone', false);
        return;
      }

      logger.info(`Adding service ${inputs.service} to zone ${inputs.zone}`);
      await execute_argv('firewall-cmd', [`--zone=${inputs.zone}`, `--add-service=${inputs.service}`, '--permanent']);
      await execute_argv('firewall-cmd', ['--reload']);
      await this.publishState(`${this.featureName}/last_action/state`, `Added service ${inputs.service} to ${inputs.zone}`, false);
    } catch (error: any) {
      logger.error(`Error adding service:`, error);
      await this.publishState(`${this.featureName}/last_action/state`, `Error: ${error.message}`, false);
    }
  }

  private async handleRemoveServiceAction(): Promise<void> {
    try {
      const inputs = await this.getCurrentInputs();
      if (!inputs.service || !inputs.zone) {
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Missing service or zone', false);
        return;
      }
      if (!this.validateServiceInputs(inputs.zone, inputs.service)) {
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Invalid service or zone', false);
        return;
      }

      logger.info(`Removing service ${inputs.service} from zone ${inputs.zone}`);
      await execute_argv('firewall-cmd', [`--zone=${inputs.zone}`, `--remove-service=${inputs.service}`, '--permanent']);
      await execute_argv('firewall-cmd', ['--reload']);
      await this.publishState(`${this.featureName}/last_action/state`, `Removed service ${inputs.service} from ${inputs.zone}`, false);
    } catch (error: any) {
      logger.error(`Error removing service:`, error);
      await this.publishState(`${this.featureName}/last_action/state`, `Error: ${error.message}`, false);
    }
  }

  private async handleInterfaceZoneChange(interfaceName: string, newZone: string): Promise<void> {
    try {
      const oldZone = this.interfaceZoneMap.get(interfaceName);
      if (!oldZone) {
        await this.publishState(`${this.featureName}/last_action/state`, `Error: Interface ${interfaceName} not found`, false);
        return;
      }

      if (oldZone === newZone) {
        return; // No change
      }

      if (!Validators.isInterface(interfaceName) || !Validators.isZone(oldZone) || !Validators.isZone(newZone)) {
        rejectInvalid('interface/zone', `${interfaceName} ${oldZone}->${newZone}`, this.featureName);
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Invalid interface or zone', false);
        return;
      }

      logger.info(`Moving interface ${interfaceName} from ${oldZone} to ${newZone}`);

      // Remove from old zone
      await execute_argv('firewall-cmd', [`--zone=${oldZone}`, `--remove-interface=${interfaceName}`, '--permanent']);
      // Add to new zone
      await execute_argv('firewall-cmd', [`--zone=${newZone}`, `--add-interface=${interfaceName}`, '--permanent']);
      // Reload firewall
      await execute_argv('firewall-cmd', ['--reload']);

      // Update internal mapping
      this.interfaceZoneMap.set(interfaceName, newZone);

      // Update state
      await this.publishState(`${this.featureName}/${interfaceName}_zone_select/state`, newZone, true);
      await this.publishState(`${this.featureName}/last_action/state`, `Moved ${interfaceName} to ${newZone}`, false);
    } catch (error: any) {
      logger.error(`Error changing interface zone:`, error);
      await this.publishState(`${this.featureName}/last_action/state`, `Error: ${error.message}`, false);
    }
  }

  private async handleAddForwardAction(): Promise<void> {
    try {
      if (!this.currentForwardPort || !this.currentForwardToAddr || !this.currentForwardToPort) {
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Missing port, destination IP or destination port', false);
        return;
      }

      if (!this.validateForwardInputs()) {
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Invalid forward port, protocol, address or zone', false);
        return;
      }

      // Note: the shell literal used single quotes around the rule; with argv the
      // value is passed verbatim as one argument, so NO surrounding quotes.
      const forwardRule = `port=${this.currentForwardPort}:proto=${this.currentForwardProtocol}:toport=${this.currentForwardToPort}:toaddr=${this.currentForwardToAddr}`;

      logger.info(`Adding port forward to zone ${this.currentForwardZone}: ${forwardRule}`);
      await execute_argv('firewall-cmd', [`--zone=${this.currentForwardZone}`, `--add-forward-port=${forwardRule}`, '--permanent']);
      await execute_argv('firewall-cmd', ['--reload']);

      await this.publishState(`${this.featureName}/last_action/state`, `Added forward ${this.currentForwardPort} → ${this.currentForwardToAddr}:${this.currentForwardToPort}`, false);

      // Clear inputs
      this.currentForwardPort = '';
      this.currentForwardToAddr = '';
      this.currentForwardToPort = '';
      await this.publishTextState(`${this.featureName}/forward_port_input/state`, '');
      await this.publishTextState(`${this.featureName}/forward_toaddr_input/state`, '');
      await this.publishTextState(`${this.featureName}/forward_toport_input/state`, '');
    } catch (error: any) {
      logger.error(`Error adding port forward:`, error);
      await this.publishState(`${this.featureName}/last_action/state`, `Error: ${error.message}`, false);
    }
  }

  private async handleRemoveForwardAction(): Promise<void> {
    try {
      if (!this.currentForwardPort || !this.currentForwardToAddr || !this.currentForwardToPort) {
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Missing port, destination IP or destination port', false);
        return;
      }

      if (!this.validateForwardInputs()) {
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Invalid forward port, protocol, address or zone', false);
        return;
      }

      const forwardRule = `port=${this.currentForwardPort}:proto=${this.currentForwardProtocol}:toport=${this.currentForwardToPort}:toaddr=${this.currentForwardToAddr}`;

      logger.info(`Removing port forward from zone ${this.currentForwardZone}: ${forwardRule}`);
      await execute_argv('firewall-cmd', [`--zone=${this.currentForwardZone}`, `--remove-forward-port=${forwardRule}`, '--permanent']);
      await execute_argv('firewall-cmd', ['--reload']);

      await this.publishState(`${this.featureName}/last_action/state`, `Removed forward ${this.currentForwardPort} → ${this.currentForwardToAddr}:${this.currentForwardToPort}`, false);

      // Clear inputs
      this.currentForwardPort = '';
      this.currentForwardToAddr = '';
      this.currentForwardToPort = '';
      await this.publishTextState(`${this.featureName}/forward_port_input/state`, '');
      await this.publishTextState(`${this.featureName}/forward_toaddr_input/state`, '');
      await this.publishTextState(`${this.featureName}/forward_toport_input/state`, '');
    } catch (error: any) {
      logger.error(`Error removing port forward:`, error);
      await this.publishState(`${this.featureName}/last_action/state`, `Error: ${error.message}`, false);
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

      await this.publishSpecs(controlEntities(feature, topic, this.availableZones));

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

      await this.publishSpecs(forwardEntities(feature, topic, this.availableZones));

      for (const zone of zoneInterfaceMap.keys()) {
        await this.publishSpecs(zoneEntities(feature, topic, zone));
      }

      // Initialize states and sync with stored values
      this.currentZone = this.availableZones[0] || 'public';
      this.currentForwardZone = this.availableZones[0] || 'public';

      await this.publishState(`${this.featureName}/last_action/state`, 'Ready', true);
      await this.publishTextState(`${this.featureName}/port_input/state`, '');
      await this.publishState(`${this.featureName}/protocol_select/state`, this.currentProtocol, true);
      await this.publishState(`${this.featureName}/zone_select/state`, this.currentZone, true);
      await this.publishTextState(`${this.featureName}/service_input/state`, '');

      // Initialize forward management states
      await this.publishTextState(`${this.featureName}/forward_port_input/state`, '');
      await this.publishTextState(`${this.featureName}/forward_toaddr_input/state`, '');
      await this.publishTextState(`${this.featureName}/forward_toport_input/state`, '');
      await this.publishState(`${this.featureName}/forward_protocol_select/state`, this.currentForwardProtocol, true);
      await this.publishState(`${this.featureName}/forward_zone_select/state`, this.currentForwardZone, true);

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
