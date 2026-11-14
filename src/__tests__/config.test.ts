// src/__tests__/config.test.ts
//
// A configuration that cannot be read must stop the agent. It used to be
// replaced by a minimal built-in one (localhost broker, no credentials, no
// feature), so systemd showed the unit running while it did nothing at all.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { version as packageVersion } from '../../package.json';

const VALID_YAML = `
mqtt:
  host: "broker.test"
  port: 1883
  username: "from-yaml"
  password: "CHANGE_ME_MQTT_PASSWORD"
  base_topic: "system_agent"
device_info:
  identifiers: ["nivuus"]
  name: "Nivuus"
  manufacturer: "nivuus"
  model: "System Agent v1.0"
  sw_version: "0.1.1"
features:
  cpu_load:
    enabled: true
`;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.MQTT_USERNAME;
  delete process.env.MQTT_PASSWORD;
  jest.restoreAllMocks();
});

function writeConfig(contents: string): string {
  const file = path.join(dir, 'agent.yaml');
  fs.writeFileSync(file, contents);
  return file;
}

/** A fresh config module per call: the manager is a module-level singleton. */
function initialize(configPath: string) {
  let manager: { config: import('../core/types').AgentConfig } | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { initializeConfigManager } = require('../config');
    manager = initializeConfigManager(configPath);
  });
  return manager!.config;
}

describe('configuration loading fails loudly', () => {
  it('throws on an empty file', () => {
    expect(() => initialize(writeConfig(''))).toThrow(/agent\.yaml/);
  });

  it('throws on a YAML syntax error', () => {
    expect(() => initialize(writeConfig('mqtt:\n  host: "broker\n  port: [1883\n'))).toThrow(/agent\.yaml/);
  });

  it('throws on a missing file', () => {
    expect(() => initialize(path.join(dir, 'absent.yaml'))).toThrow(/absent\.yaml/);
  });

  it('throws when mqtt.host is missing', () => {
    expect(() => initialize(writeConfig(VALID_YAML.replace('  host: "broker.test"\n', ''))))
      .toThrow(/mqtt\.host/);
  });

  it('throws when device_info.identifiers is missing', () => {
    expect(() => initialize(writeConfig(VALID_YAML.replace('  identifiers: ["nivuus"]\n', ''))))
      .toThrow(/device_info\.identifiers/);
  });

  it('throws when the features section is missing', () => {
    expect(() => initialize(writeConfig(VALID_YAML.replace(/features:[\s\S]*$/, ''))))
      .toThrow(/features/);
  });
});

describe('a valid configuration', () => {
  it('loads, with the credentials of the environment winning over the file', () => {
    process.env.MQTT_USERNAME = 'from-env';
    process.env.MQTT_PASSWORD = 'secret-from-env';
    const config = initialize(writeConfig(VALID_YAML));
    expect(config.mqtt).toMatchObject({ host: 'broker.test', port: 1883, base_topic: 'system_agent' });
    expect(config.mqtt.username).toBe('from-env');
    expect(config.mqtt.password).toBe('secret-from-env');
    expect(config.features.cpu_load.enabled).toBe(true);
  });

  it('keeps the file credentials when the environment sets none', () => {
    const config = initialize(writeConfig(VALID_YAML));
    expect(config.mqtt.username).toBe('from-yaml');
  });

  it('reports the version of package.json, whatever the file says', () => {
    const config = initialize(writeConfig(VALID_YAML));
    expect(config.device_info.sw_version).toBe(packageVersion);
  });
});
