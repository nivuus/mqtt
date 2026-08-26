// src/config.ts

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { AgentConfig, DeviceInfo } from './core/types';
// Import logger directly for internal use within ConfigManager, carefully.
// This creates a potential circular dependency if logger itself tries to use ConfigManager during its own static initialization.
// However, for simple console logging within ConfigManager's error paths, it's generally acceptable if logger's own static init doesn't call getConfigManager.
// We will use console.error directly in critical error paths of ConfigManager to be safe.
import { version as agentVersion } from '../package.json'; // Get version from package.json

const DEFAULT_CONFIG_PATH = path.join(__dirname, '../config/agent.yaml');

/**
 * Loads, validates, and provides access to the agent's configuration.
 */
class ConfigManager {
  private static instance: ConfigManager;
  public readonly config: AgentConfig;

  private constructor(configPath: string = DEFAULT_CONFIG_PATH) {
    try {
      const fileContents = fs.readFileSync(configPath, 'utf8');
      // Use type assertion for yaml.load if @types/js-yaml is not being picked up
      const loadedConfig = (yaml.load(fileContents) as any) as Partial<AgentConfig>;
      this.config = this.validateAndMergeDefaults(loadedConfig);

      // Update sw_version with actual package version if not explicitly set or still placeholder
      if (!this.config.device_info.sw_version || this.config.device_info.sw_version.includes('0.1.0')) {
        this.config.device_info.sw_version = agentVersion;
      }

      // Ensure device_info.identifiers is an array
      if (typeof this.config.device_info.identifiers === 'string') {
        this.config.device_info.identifiers = [this.config.device_info.identifiers];
      }

    } catch (error: any) {
      // Use console.error directly here to avoid issues if logger itself fails or isn't ready
      console.error(`Error loading or parsing configuration file from ${configPath}:`, error.message);
      this.config = this.getMinimalDefaultConfig();
      console.warn("Agent is running with minimal default configuration due to loading error. Please check your config/agent.yaml file.");
    }
  }

  public static getInstance(configPath?: string): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(configPath);
    }
    return ConfigManager.instance;
  }

  private validateAndMergeDefaults(loadedConfig: Partial<AgentConfig>): AgentConfig {
    const defaultConfig: AgentConfig = {
      mqtt: {
        host: 'localhost',
        port: 1883,
        base_topic: 'system_agent',
        username: '',
        password: '',
      },
      device_info: {
        identifiers: ['default_mqtt_system_agent_id'],
        name: 'System Agent',
        manufacturer: 'Cline Agent',
        model: 'System Agent vDefault',
        sw_version: agentVersion,
      },
      features: {},
      logging: {
        level: 'info',
      },
    };

    // Deep merge, prioritizing loadedConfig values
    const mergedConfig = { ...defaultConfig, ...loadedConfig };
    mergedConfig.mqtt = { ...defaultConfig.mqtt, ...loadedConfig.mqtt };
    mergedConfig.device_info = { ...defaultConfig.device_info, ...loadedConfig.device_info } as DeviceInfo; // Cast needed after spread
    mergedConfig.features = { ...defaultConfig.features, ...loadedConfig.features };
    mergedConfig.logging = { ...defaultConfig.logging, ...loadedConfig.logging };

    // Override MQTT credentials with environment variables if provided
    // This allows securing sensitive credentials outside of config files
    if (process.env.MQTT_USERNAME) {
      mergedConfig.mqtt.username = process.env.MQTT_USERNAME;
    }
    if (process.env.MQTT_PASSWORD) {
      mergedConfig.mqtt.password = process.env.MQTT_PASSWORD;
    }

    // Ensure essential fields are present
    if (!mergedConfig.mqtt.host || !mergedConfig.mqtt.base_topic) {
        throw new Error('MQTT host and base_topic are required in configuration.');
    }
    if (!mergedConfig.device_info.identifiers || mergedConfig.device_info.identifiers.length === 0) {
        throw new Error('Device identifiers are required in configuration.');
    }
    if (typeof mergedConfig.device_info.identifiers === 'string') {
        mergedConfig.device_info.identifiers = [mergedConfig.device_info.identifiers];
    }


    return mergedConfig as AgentConfig;
  }

  private getMinimalDefaultConfig(): AgentConfig {
    // This is a fallback for critical errors, allowing the agent to *potentially* start
    // but likely in a non-functional or limited state.
    // Uses the same device identifier to maintain entity consistency in Home Assistant
    return {
      mqtt: {
        host: 'localhost', // Sensible default, but likely needs user config
        port: 1883,
        base_topic: 'system_agent', // Same base topic as normal config for consistency
      },
      device_info: {
        identifiers: ['nivuus'], // Same identifier to maintain entity consistency
        name: 'Nivuus',
        manufacturer: 'nivuus',
        model: 'System Agent v1.0',
        sw_version: agentVersion,
      },
      features: {}, // No features enabled by default on error
      logging: {
        level: 'debug', // More verbose logging if in error state
      },
    };
  }

  public getFeatureConfig(featureName: string) {
    return this.config.features[featureName];
  }
}

let configManagerInstance: ConfigManager;

/**
 * Initializes the ConfigManager singleton instance.
 * This should be called once at application startup.
 * @param configPath Optional path to the configuration file.
 * @returns The initialized ConfigManager instance.
 */
export function initializeConfigManager(configPath?: string): ConfigManager {
    if (!configManagerInstance) {
      configManagerInstance = ConfigManager.getInstance(configPath);
    } else if (configPath) {
      // Use console.warn directly here
      console.warn(`ConfigManager already initialized. Ignoring new config path: ${configPath}. Using previously initialized instance.`);
    }
    return configManagerInstance;
}

/**
 * Retrieves the singleton instance of ConfigManager.
 * Ensure initializeConfigManager has been called prior to this.
 * @returns The ConfigManager instance.
 * @throws Error if ConfigManager is not initialized.
 */
export function getConfigManager(): ConfigManager {
  if (!configManagerInstance) {
    // Fallback to initialize with default path if not already done.
    // Use console.warn directly here
    console.warn("ConfigManager accessed before explicit initialization in main entry point. Initializing with default path.");
    return initializeConfigManager();
  }
  return configManagerInstance;
}
