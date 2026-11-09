// src/websocket/WizardHandler.ts

import { WizardCommand, FeatureName, FeatureHandlers } from './types';
import { createNetworkHandlers } from './wizard/networkHandlers';
import { createFirewallHandlers } from './wizard/firewallHandlers';
import { createWifiHandlers } from './wizard/wifiHandlers';
import { createPppoeHandlers } from './wizard/pppoeHandlers';
import { createVmHandlers } from './wizard/vmHandlers';
import { createSystemHandlers } from './wizard/systemHandlers';
import { createWizardStateHandlers } from './wizard/wizardStateHandlers';

/**
 * Handler for wizard commands
 * Routes commands to the appropriate feature handlers (one module per feature
 * under ./wizard/).
 */
export class WizardHandler {
  private readonly handlers: Map<FeatureName, FeatureHandlers> = new Map();

  constructor() {
    this.handlers.set('network', createNetworkHandlers());
    this.handlers.set('firewall', createFirewallHandlers());
    this.handlers.set('wifi', createWifiHandlers());
    this.handlers.set('pppoe', createPppoeHandlers());
    this.handlers.set('vm', createVmHandlers());
    this.handlers.set('system', createSystemHandlers());
    this.handlers.set('wizard', createWizardStateHandlers());
  }

  /**
   * Adds a feature whose handlers depend on something created at runtime (e.g. an
   * optional agent feature). Commands for it go through the same own-property guard.
   */
  public registerFeature(name: FeatureName, handlers: FeatureHandlers): void {
    this.handlers.set(name, handlers);
  }

  /**
   * Handle an incoming wizard command
   */
  public async handleCommand(command: WizardCommand): Promise<unknown> {
    const featureHandlers = this.handlers.get(command.feature);
    if (!featureHandlers) {
      throw new Error(`Unknown feature: ${command.feature}`);
    }

    // Own properties only: an action such as "constructor" or "toString" must
    // not resolve to a method inherited from Object.prototype.
    const isOwnAction = Object.prototype.hasOwnProperty.call(featureHandlers, command.action);
    const handler = isOwnAction ? featureHandlers[command.action] : undefined;
    if (!handler) {
      throw new Error(`Unknown action: ${command.action} for feature ${command.feature}`);
    }

    return handler(command.params || {});
  }
}
