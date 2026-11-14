// src/config.ts

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { AgentConfig } from './core/types';
// ConfigManager reports its own failures by throwing, never through the logger:
// the logger reads its level from this configuration.
import { version as agentVersion } from '../package.json';

const DEFAULT_CONFIG_PATH = path.join(__dirname, '../config/agent.yaml');

/**
 * A configuration the agent cannot run with. There is no fallback: a missing,
 * empty, truncated or malformed file used to be replaced by a built-in minimal
 * configuration (localhost broker, no credentials, no feature), and the agent
 * then ran doing nothing while systemd reported it healthy. Throwing makes the
 * entry point exit non-zero, so the unit shows the failure.
 */
export class ConfigError extends Error {
  constructor(configPath: string, reason: string) {
    super(`Invalid configuration ${configPath}: ${reason}`);
    this.name = 'ConfigError';
  }
}

type Mapping = Record<string, unknown>;

function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function readYaml(configPath: string): unknown {
  let contents: string;
  try {
    contents = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    throw new ConfigError(configPath, `cannot be read (${(error as Error).message})`);
  }
  try {
    return yaml.load(contents);
  } catch (error) {
    throw new ConfigError(configPath, `is not valid YAML (${(error as Error).message})`);
  }
}

/**
 * Reads and validates the configuration file, then applies the environment
 * overrides: MQTT_USERNAME / MQTT_PASSWORD win over the file, which a package
 * upgrade overwrites with placeholders.
 */
export function loadAgentConfig(configPath: string, env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const loaded = readYaml(configPath);
  const fail = (reason: string): never => { throw new ConfigError(configPath, reason); };

  if (!isMapping(loaded)) fail('the file is empty or is not a YAML mapping');
  const root = loaded as Mapping;

  const mqtt = root.mqtt;
  if (!isMapping(mqtt)) fail('the mqtt section is missing');
  const mqttSection = mqtt as Mapping;
  if (!isNonEmptyString(mqttSection.host)) fail('mqtt.host is required');
  if (!isNonEmptyString(mqttSection.base_topic)) fail('mqtt.base_topic is required');
  const port = mqttSection.port ?? 1883;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    fail('mqtt.port must be an integer between 1 and 65535');
  }

  const deviceInfo = root.device_info;
  if (!isMapping(deviceInfo)) fail('the device_info section is missing');
  const deviceSection = deviceInfo as Mapping;
  const rawIdentifiers = deviceSection.identifiers;
  const identifiers = typeof rawIdentifiers === 'string' ? [rawIdentifiers] : rawIdentifiers;
  if (!Array.isArray(identifiers) || identifiers.length === 0 || !identifiers.every(isNonEmptyString)) {
    fail('device_info.identifiers must be a non-empty list of names');
  }

  if (!isMapping(root.features)) fail('the features section is missing');
  if (root.logging !== undefined && !isMapping(root.logging)) fail('logging must be a mapping');

  const config = {
    ...root,
    mqtt: {
      ...mqttSection,
      port,
      username: env.MQTT_USERNAME || mqttSection.username,
      password: env.MQTT_PASSWORD || mqttSection.password,
    },
    device_info: {
      name: 'System Agent',
      manufacturer: 'nivuus',
      model: 'System Agent',
      ...deviceSection,
      identifiers,
      // The version of the running build, never a value copied into the YAML.
      sw_version: agentVersion,
    },
    features: root.features,
    logging: { level: 'info', ...(root.logging as Mapping | undefined) },
  };
  return config as unknown as AgentConfig;
}

// Configuration keys (English identifiers of agent.yaml, not user text) whose value is a credential.
const CREDENTIAL_KEY = /password|passphrase|token|secret/i;

/**
 * The configuration as index.ts logs it, every credential masked: the loaded value
 * carries the broker password of the environment file, and the journal is readable
 * far more widely than that file.
 */
export function describeConfig(config: AgentConfig): string {
  return JSON.stringify(config, (key, value) =>
    CREDENTIAL_KEY.test(key) && typeof value === 'string' && value !== '' ? '***' : value, 2);
}

/**
 * Loads, validates, and provides access to the agent's configuration.
 */
class ConfigManager {
  private static instance: ConfigManager;
  public readonly config: AgentConfig;

  private constructor(configPath: string = DEFAULT_CONFIG_PATH) {
    this.config = loadAgentConfig(configPath);
  }

  public static getInstance(configPath?: string): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(configPath);
    }
    return ConfigManager.instance;
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
 * @throws ConfigError when the file is missing, malformed or incomplete.
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
