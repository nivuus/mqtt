/**
 * Pure text handling of a NetworkManager PPPoE keyfile (GLib key-file format, see
 * nm-settings-keyfile(5) and the GLib "Key-value file parser" reference): reading the profile
 * UUID and the PPPoE user name, and replacing the credentials in the `[pppoe]` group.
 */

export interface PppoeKeyfileFields {
  uuid?: string;
  username?: string;
}

/** GLib string escapes: `\s` space, `\n`, `\t`, `\r`, `\\`. */
function unescapeValue(raw: string): string {
  return raw.replace(/\\([sntr\\])/g, (_m, c: string) => ({ s: ' ', n: '\n', t: '\t', r: '\r', '\\': '\\' })[c]!);
}

/**
 * Escapes a value the way g_key_file_set_string() does. Control characters are refused
 * upstream (Validators.isConfigSafeLine), so only the backslash and a leading space remain.
 */
export function escapeKeyfileValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/^ /, '\\s');
}

function groupOf(line: string): string | undefined {
  const t = line.trim();
  return t.startsWith('[') && t.endsWith(']') ? t.slice(1, -1) : undefined;
}

function keyOf(line: string): string | undefined {
  const at = line.indexOf('=');
  return at > 0 ? line.slice(0, at).trim() : undefined;
}

function valueOf(line: string): string {
  return unescapeValue(line.slice(line.indexOf('=') + 1).trimStart());
}

/** The profile UUID (`[connection] uuid=`) and the PPPoE user name. The password is never read out. */
export function readPppoeKeyfile(text: string): PppoeKeyfileFields {
  const fields: PppoeKeyfileFields = {};
  let group: string | undefined;
  for (const line of text.split('\n')) {
    group = groupOf(line) ?? group;
    const key = keyOf(line);
    if (group === 'connection' && key === 'uuid') fields.uuid = valueOf(line);
    if (group === 'pppoe' && key === 'username') fields.username = valueOf(line);
  }
  return fields;
}

/**
 * The keyfile with `username` and `password` set in `[pppoe]`: existing keys are replaced in
 * place, missing ones are added at the end of the group, every other line is kept verbatim.
 * Throws when the file has no `[pppoe]` group.
 */
export function withPppoeCredentials(text: string, username: string, password: string): string {
  const wanted = new Map([['username', escapeKeyfileValue(username)], ['password', escapeKeyfileValue(password)]]);
  const lines = text.split('\n');
  const out: string[] = [];
  let group: string | undefined;
  let sawPppoe = false;

  const flushMissing = () => {
    // Insert before the blank lines that separate the group from the next one.
    let at = out.length;
    while (at > 0 && out[at - 1].trim() === '') at--;
    out.splice(at, 0, ...[...wanted].map(([k, v]) => `${k}=${v}`));
    wanted.clear();
  };

  for (const line of lines) {
    const next = groupOf(line);
    if (next !== undefined) {
      if (group === 'pppoe') flushMissing();
      group = next;
      sawPppoe ||= next === 'pppoe';
      out.push(line);
      continue;
    }
    const key = keyOf(line);
    if (group === 'pppoe' && key !== undefined && wanted.has(key)) {
      out.push(`${key}=${wanted.get(key)}`);
      wanted.delete(key);
      continue;
    }
    out.push(line);
  }
  if (group === 'pppoe') flushMissing();
  if (!sawPppoe) throw new Error('the keyfile has no [pppoe] group');
  return out.join('\n');
}
