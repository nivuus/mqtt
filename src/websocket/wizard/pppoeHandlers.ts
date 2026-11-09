// src/websocket/wizard/pppoeHandlers.ts

import { FeatureHandlers } from '../types';
import { execute_argv } from '../../utils/exec';
import { Validators } from '../../utils/validators';
import { writeRootFile } from './rootFile';

const NMCONNECTION_PATH = '/etc/NetworkManager/system-connections/pppoe-enp6s0.835.nmconnection';

function extractIniValue(content: string, section: string, key: string): string | null {
  const sectionRegex = new RegExp(`\\[${section}\\]([\\s\\S]*?)(?=\\[|$)`, 'i');
  const sectionMatch = content.match(sectionRegex);
  if (!sectionMatch) return null;

  const keyRegex = new RegExp(`^${key}=(.*)$`, 'm');
  const keyMatch = sectionMatch[1].match(keyRegex);
  return keyMatch ? keyMatch[1].trim() : null;
}

function updateIniValue(content: string, section: string, key: string, value: string): string {
  const sectionRegex = new RegExp(`(\\[${section}\\][\\s\\S]*?)^${key}=.*$`, 'm');
  if (content.match(sectionRegex)) {
    return content.replace(sectionRegex, `$1${key}=${value}`);
  }
  // Key not found, add it to section
  const sectionHeaderRegex = new RegExp(`(\\[${section}\\])`, 'i');
  return content.replace(sectionHeaderRegex, `$1\n${key}=${value}`);
}

export function createPppoeHandlers(): FeatureHandlers {
  return {
    get_credentials: async () => {
      try {
        const result = await execute_argv('sudo', ['cat', NMCONNECTION_PATH]);
        if (result.exitCode !== 0) return { found: false };

        const content = result.stdout;
        const username = extractIniValue(content, 'pppoe', 'username');
        const password = extractIniValue(content, 'pppoe', 'password');

        return { found: true, username, password: password ? '***' : null };
      } catch {
        return { found: false };
      }
    },

    set_credentials: async (params) => {
      const { username, password } = params as { username: string; password: string };
      if (!username || !password) throw new Error('Missing username or password');
      // Written verbatim into an INI line — reject control characters.
      if (!Validators.isConfigSafeLine(username) || !Validators.isConfigSafeLine(password)) {
        throw new Error('Invalid characters in username or password');
      }

      // Read current config
      const result = await execute_argv('sudo', ['cat', NMCONNECTION_PATH]);
      let content = result.stdout;

      // Update credentials
      content = updateIniValue(content, 'pppoe', 'username', username);
      content = updateIniValue(content, 'pppoe', 'password', password);

      // Backup and write (via fs → no shell, no injection), then lock down perms
      await writeRootFile(NMCONNECTION_PATH, content, 0o600);
      await execute_argv('sudo', ['chmod', '600', NMCONNECTION_PATH]);

      return { success: true };
    },

    restart: async () => {
      await execute_argv('sudo', ['nmcli', 'connection', 'reload']);
      await execute_argv('sudo', ['nmcli', 'connection', 'down', 'pppoe-enp6s0.835']); // may fail if already down
      await execute_argv('sudo', ['nmcli', 'connection', 'up', 'pppoe-enp6s0.835']);
      return { success: true };
    },

    test_connection: async () => {
      const result = await execute_argv('ip', ['addr', 'show', 'ppp0']);
      const isUp = result.exitCode === 0 && result.stdout.includes('state UP');
      return { connected: isUp };
    },
  };
}
