/**
 * Builds the exact text handed to `nmcli connection import`, from the uploaded profile and
 * the optional separate CA file. Pure, no I/O.
 *
 * The CA file is uploaded too, and is pasted into a profile imported as root, so it is held
 * to the strictest shape: PEM CERTIFICATE blocks and nothing else. Without that a "CA"
 * holding `</ca>` followed by directives would smuggle them past the profile validation.
 * The combined text is then validated again as a whole.
 */
import { validateOvpnProfile } from './ovpnProfile';

const BEGIN = '-----BEGIN CERTIFICATE-----';
const END = '-----END CERTIFICATE-----';
const BASE64_LINE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Returns the CA as normalized PEM certificate blocks, or throws naming what is wrong. */
export function normalizeCaPem(ca: string): string {
  const lines = ca.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trim());
  const out: string[] = [];
  let inBlock = false;
  let bodyLines = 0;
  for (const line of lines) {
    if (!inBlock) {
      if (line === '') continue;
      if (line !== BEGIN) throw new Error('CA file must contain only PEM CERTIFICATE blocks');
      inBlock = true;
      bodyLines = 0;
    } else if (line === END) {
      if (bodyLines === 0) throw new Error('CA file has an empty certificate');
      inBlock = false;
    } else if (BASE64_LINE.test(line)) {
      bodyLines++;
    } else {
      throw new Error('CA file has a line that is not base64 inside a certificate');
    }
    out.push(line);
  }
  if (inBlock) throw new Error('CA file has an unterminated certificate');
  if (out.length === 0) throw new Error('CA file holds no certificate');
  return out.join('\n');
}

/** Replaces the `ca <file>` directive with an inline `<ca>` block holding `pem`. */
function inlineCa(profile: string, pem: string): string {
  return profile
    .split('\n')
    .map(line => (line.trim().split(/\s+/)[0].replace(/^--/, '').toLowerCase() === 'ca'
      ? `<ca>\n${pem}\n</ca>`
      : line))
    .join('\n');
}

/**
 * Validates the profile and, when it references a CA file, inlines the uploaded CA: NM keeps
 * `ca <file>` as a path reference and copies nothing, so a CA staged in a temporary
 * directory would vanish, whereas NM copies an inline block into its certificate store.
 */
export function prepareProfileText(ovpn: string, ca?: string): string {
  const validation = validateOvpnProfile(ovpn, ca);
  if (!validation.ok) throw new Error(`invalid OpenVPN profile: ${validation.reason}`);
  if (!validation.needsCa) return validation.normalized;

  const combined = inlineCa(validation.normalized, normalizeCaPem(ca as string));
  const recheck = validateOvpnProfile(combined);
  if (!recheck.ok) throw new Error(`invalid OpenVPN profile once the CA is inlined: ${recheck.reason}`);
  if (recheck.needsCa) throw new Error('the profile still references a ca file once the CA is inlined');
  return recheck.normalized;
}
