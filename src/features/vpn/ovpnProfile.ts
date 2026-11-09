/**
 * Validation of an uploaded OpenVPN profile (pure, no I/O).
 *
 * The profile comes from a phone upload and is later imported into NetworkManager as root,
 * so every directive that can run a command or load a plugin is refused.
 */

export const MAX_PROFILE_BYTES = 65536;

export type OvpnValidation =
  | { ok: true; normalized: string; needsCa: boolean }
  | { ok: false; reason: string };

const FORBIDDEN_DIRECTIVES = new Set([
  'up', 'down', 'route-up', 'route-pre-down', 'ipchange', 'client-connect',
  'client-disconnect', 'learn-address', 'auth-user-pass-verify', 'tls-verify',
  'plugin', 'script-security',
]);

const OPEN_TAG = /^<([a-z0-9-]+)>$/i;

export function validateOvpnProfile(ovpn: string, ca?: string): OvpnValidation {
  if (Buffer.byteLength(ovpn, 'utf8') > MAX_PROFILE_BYTES) {
    return { ok: false, reason: `profile exceeds ${MAX_PROFILE_BYTES} bytes` };
  }

  const normalized = ovpn.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let hasRemote = false;
  let hasInlineCa = false;
  let caReference = false;
  let openBlock: string | null = null;

  for (const raw of normalized.split('\n')) {
    const line = raw.trim();
    if (openBlock) {
      if (line.toLowerCase() === `</${openBlock}>`) openBlock = null;
      continue;
    }
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;

    const tag = OPEN_TAG.exec(line);
    if (tag) {
      openBlock = tag[1].toLowerCase();
      if (openBlock === 'ca') hasInlineCa = true;
      continue;
    }

    const name = line.split(/\s+/)[0].replace(/^--/, '').toLowerCase();
    if (FORBIDDEN_DIRECTIVES.has(name)) {
      return { ok: false, reason: `directive "${name}" is not allowed` };
    }
    if (name === 'remote') hasRemote = true;
    if (name === 'ca') caReference = true;
  }

  if (openBlock) return { ok: false, reason: `unterminated <${openBlock}> block` };
  if (!hasRemote) return { ok: false, reason: 'profile has no remote directive' };

  const needsCa = caReference && !hasInlineCa;
  if (needsCa && !ca) {
    return { ok: false, reason: 'profile references a ca file but none was provided' };
  }
  return { ok: true, normalized, needsCa };
}
