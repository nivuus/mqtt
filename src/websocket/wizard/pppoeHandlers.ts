// src/websocket/wizard/pppoeHandlers.ts

import { FeatureHandlers } from '../types';
import { execute_argv } from '../../utils/exec';
import { Validators } from '../../utils/validators';
import { sectionRange, setKey } from '../../features/vpn/nmSecrets';
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

/**
 * Set the [pppoe] credentials of a NetworkManager keyfile. Line-based (no replacement
 * patterns, so `$` in a value is literal) and escaped as GKeyFile reads it, so any
 * printable value in any script round-trips. Every other line stays as it was.
 */
export function setPppoeCredentials(content: string, username: string, password: string): string {
  let lines = content.split('\n');
  if (!sectionRange(lines, 'pppoe')) throw new Error(`${NMCONNECTION_PATH} has no [pppoe] section`);
  lines = setKey(lines, 'pppoe', 'username', username);
  lines = setKey(lines, 'pppoe', 'password', password);
  return lines.join('\n');
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
      const content = setPppoeCredentials(result.stdout, username, password);

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
