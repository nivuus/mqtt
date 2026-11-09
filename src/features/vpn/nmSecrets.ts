/**
 * Writes the VPN credentials into the profile's NetworkManager keyfile.
 *
 * nmcli takes secrets only as argv, and `execute_argv` logs its argv, so the agent (root)
 * edits the 0600 keyfile itself and then asks NM to reload it. Only the `[vpn]` keys
 * `username` / `password-flags` and the `[vpn-secrets]` key `password` are touched; every
 * other line stays byte for byte.
 *
 * Values are escaped as GLib's GKeyFile reads them (g_key_file_set_string), so a password in
 * any script, with backslashes or leading spaces, round-trips unchanged.
 */
import { promises as fs } from 'fs';
import { writeFileAtomic0600 } from './atomicFile';

export interface VpnCredentials {
  username: string;
  password: string;
}

const SECTION = /^\s*\[([^\]]+)\]\s*$/;

export function escapeKeyfileValue(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === ' ' && i === 0) out += '\\s';
    else out += ch;
  }
  return out;
}

function sectionRange(lines: string[], name: string): { start: number; end: number } | undefined {
  const start = lines.findIndex(l => SECTION.exec(l)?.[1] === name);
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && !SECTION.test(lines[end])) end++;
  return { start, end };
}

/** Sets `key=value` in `[section]`, dropping every previous occurrence of the key there. */
function setKey(lines: string[], section: string, key: string, value: string): string[] {
  const entry = `${key}=${escapeKeyfileValue(value)}`;
  const range = sectionRange(lines, section);
  if (!range) {
    const head = lines.length && lines[lines.length - 1] !== '' ? [...lines, ''] : [...lines];
    return [...head, `[${section}]`, entry, ''];
  }
  const isKey = (line: string) => line.includes('=') && line.split('=')[0].trim() === key;
  const body = lines.slice(range.start + 1, range.end).filter(l => !isKey(l));
  let insertAt = body.length;
  while (insertAt > 0 && body[insertAt - 1].trim() === '') insertAt--;
  body.splice(insertAt, 0, entry);
  return [...lines.slice(0, range.start + 1), ...body, ...lines.slice(range.end)];
}

export async function writeVpnCredentials(keyfilePath: string, creds: VpnCredentials): Promise<void> {
  const original = await fs.readFile(keyfilePath, 'utf8');
  let lines = original.split('\n');
  if (!sectionRange(lines, 'vpn')) {
    throw new Error(`${keyfilePath} has no [vpn] section: not a VPN keyfile`);
  }
  lines = setKey(lines, 'vpn', 'username', creds.username);
  // 0 = NM keeps the secret itself (system-owned), so activation needs no secret agent.
  lines = setKey(lines, 'vpn', 'password-flags', '0');
  lines = setKey(lines, 'vpn-secrets', 'password', creds.password);
  await writeFileAtomic0600(keyfilePath, lines.join('\n'));
}
