// debian/__tests__/packaging.test.ts
//
// The contract between the package and the host it lands on. Both files below are shipped
// as they are (fpm copies the unit and config/agent.yaml into the .deb), so they are parsed
// here, as systemd and the agent parse them, rather than searched as text.

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.join(__dirname, '..', '..');
const ENV_FILE = '/etc/mqtt-system-agent.env';

/** The values of one directive of a unit section, in file order (a directive may repeat). */
function directive(unitText: string, section: string, name: string): string[] {
  const values: string[] = [];
  let current = '';
  for (const raw of unitText.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = header[1];
      continue;
    }
    const separator = line.indexOf('=');
    if (current === section && separator > 0 && line.slice(0, separator).trim() === name) {
      values.push(line.slice(separator + 1).trim());
    }
  }
  return values;
}

describe('mqtt-system-agent.service', () => {
  const unit = fs.readFileSync(path.join(ROOT, 'debian', 'mqtt-system-agent.service'), 'utf8');

  it('reads the environment file every document points to', () => {
    const files = directive(unit, 'Service', 'EnvironmentFile').map((value) => value.replace(/^-/, ''));
    expect(files).toContain(ENV_FILE);
  });

  it('starts when that file does not exist', () => {
    // systemd.exec(5): without the "-" prefix a missing file fails the unit before ExecStart.
    const mandatory = directive(unit, 'Service', 'EnvironmentFile').filter((value) => !value.startsWith('-'));
    expect(mandatory).toEqual([]);
  });

  it('carries no credential of its own', () => {
    const assigned = directive(unit, 'Service', 'Environment').map((value) => value.split('=')[0]);
    expect(assigned.filter((name) => /USERNAME|PASSWORD|TOKEN|SECRET/.test(name))).toEqual([]);
  });
});

describe('the shipped config/agent.yaml', () => {
  const config = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'agent.yaml'), 'utf8')) as {
    mqtt: Record<string, unknown>;
  };

  it('names no broker account: the same one on every install is a shared credential', () => {
    expect(config.mqtt.username ?? '').toBe('');
    expect(config.mqtt.password ?? '').toBe('');
  });

  it('still says where the broker is', () => {
    expect(typeof config.mqtt.host).toBe('string');
    expect(config.mqtt.base_topic).toBe('system_agent');
  });
});
