// src/websocket/wizard/pppoeHandlers.ts

import { FeatureHandlers } from '../types';
import { execute_argv } from '../../utils/exec';
import { Validators } from '../../utils/validators';
import { sectionRange, setKey } from '../../features/vpn/nmSecrets';
import { writeFileAtomic0600 } from '../../features/vpn/atomicFile';

const CONNECTION_NAME = 'pppoe-enp6s0.835';
const NMCONNECTION_PATH = `/etc/NetworkManager/system-connections/${CONNECTION_NAME}.nmconnection`;
// nmcli waits up to 90 s for an activation by default: give the process time to finish it.
const NMCLI_TIMEOUT_MS = 100000;

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

/** Run nmcli and throw with its own message when it fails (execute_argv never rejects). */
async function nmcli(args: string[], quiet = false): Promise<string> {
  const result = await execute_argv('sudo', ['nmcli', ...args], { timeoutMs: NMCLI_TIMEOUT_MS, quiet });
  if (result.exitCode !== 0) {
    const why = result.stderr.trim() || result.spawnError || `exit ${result.exitCode}`;
    throw new Error(`nmcli ${args.join(' ')} failed: ${why}`);
  }
  return result.stdout;
}

async function readProfile(): Promise<string> {
  const result = await execute_argv('sudo', ['cat', NMCONNECTION_PATH], { quiet: true });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read ${NMCONNECTION_PATH}: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
  }
  return result.stdout;
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

      // A failed read or a profile without [pppoe] throws before anything is written.
      const original = await readProfile();
      const content = setPppoeCredentials(original, username, password);

      // Each file is replaced atomically: created 0600 next to its target, fsynced, renamed.
      await writeFileAtomic0600(`${NMCONNECTION_PATH}.backup`, original);
      await writeFileAtomic0600(NMCONNECTION_PATH, content);

      return { success: true };
    },

    restart: async () => {
      await nmcli(['connection', 'reload']);
      // Take the link down only when it is up: `down` on an inactive profile is an error.
      const active = (await nmcli(['-g', 'NAME', 'connection', 'show', '--active'], true)).split('\n');
      if (active.includes(CONNECTION_NAME)) await nmcli(['connection', 'down', CONNECTION_NAME]);
      await nmcli(['connection', 'up', CONNECTION_NAME]);
      return { success: true };
    },

    test_connection: async () => {
      const result = await execute_argv('ip', ['addr', 'show', 'ppp0']);
      const isUp = result.exitCode === 0 && result.stdout.includes('state UP');
      return { connected: isUp };
    },
  };
}
