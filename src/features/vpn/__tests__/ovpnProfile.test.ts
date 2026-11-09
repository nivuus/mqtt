import { validateOvpnProfile, MAX_PROFILE_BYTES } from '../ovpnProfile';

const BASE = ['client', 'dev tun', 'proto udp', 'remote vpn.example.com 1194'];
const INLINE_CA = ['<ca>', '-----BEGIN CERTIFICATE-----', 'abc', '-----END CERTIFICATE-----', '</ca>'];
const profile = (...extra: string[]) => [...BASE, ...extra].join('\n');

describe('validateOvpnProfile', () => {
  it('accepts a ZoogVPN-style profile with inline <ca>', () => {
    const r = validateOvpnProfile(profile('auth-user-pass', 'cipher AES-256-CBC', ...INLINE_CA));
    expect(r).toMatchObject({ ok: true, needsCa: false });
  });

  it('accepts a profile referencing ca ca.crt when ca is given', () => {
    const r = validateOvpnProfile(profile('ca ca.crt'), '-----BEGIN CERTIFICATE-----');
    expect(r).toMatchObject({ ok: true, needsCa: true });
  });

  it('rejects ca reference without a ca file', () => {
    const r = validateOvpnProfile(profile('ca ca.crt'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/ca/);
  });

  it('rejects profiles over 64 KiB', () => {
    expect(validateOvpnProfile(profile('# ' + 'x'.repeat(MAX_PROFILE_BYTES))).ok).toBe(false);
  });

  it('measures the size in bytes, not characters', () => {
    expect(validateOvpnProfile(profile('# ' + 'é'.repeat(MAX_PROFILE_BYTES / 2))).ok).toBe(false);
  });

  it('rejects missing remote', () => {
    const r = validateOvpnProfile('client\ndev tun');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/remote/);
  });

  const FORBIDDEN = ['up', 'down', 'route-up', 'route-pre-down', 'ipchange', 'client-connect',
    'client-disconnect', 'learn-address', 'auth-user-pass-verify', 'tls-verify', 'plugin', 'script-security'];
  it.each(FORBIDDEN)('rejects %s, plain, indented and in -- form', (d) => {
    for (const line of [`${d} /bin/sh`, `   \t${d} /bin/sh`, `--${d} /bin/sh`, `  --${d.toUpperCase()} x`]) {
      const r = validateOvpnProfile(profile(line));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain(d);
    }
  });

  it('does not treat commented directives or similar names as forbidden', () => {
    expect(validateOvpnProfile(profile('# up /bin/sh', '; down x', 'up-delay', 'tls-version-min 1.2')).ok).toBe(true);
  });

  it('strips a UTF-8 BOM and normalizes CRLF', () => {
    const r = validateOvpnProfile('﻿' + BASE.join('\r\n') + '\r\n' + INLINE_CA.join('\r\n'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized).not.toContain('\r');
      expect(r.normalized.charCodeAt(0)).not.toBe(0xfeff);
    }
  });

  it('ignores directive names inside <cert> blocks', () => {
    expect(validateOvpnProfile(profile('<cert>', 'up /bin/sh', '</cert>', ...INLINE_CA)).ok).toBe(true);
  });

  it('rejects an unterminated inline block', () => {
    expect(validateOvpnProfile(profile('<ca>', 'abc')).ok).toBe(false);
  });
});
