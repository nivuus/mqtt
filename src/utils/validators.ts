// src/utils/validators.ts
//
// Strict per-field validators used as the first line of defence, BEFORE any
// command is executed. Every value that reaches a system command and originates
// from MQTT / an external user must be validated here and rejected on mismatch.
//
// These validators are deliberately conservative (allow-list character sets).
// They complement `execute_argv` (which removes shell-injection entirely) by
// also rejecting values that, while shell-safe, would be interpreted as options
// by the target program (e.g. a value starting with `-`) or would corrupt a
// config file (e.g. embedded newlines).

import logger from './logger';

// Firewalld zone name, e.g. "public", "home", "internal".
const ZONE_RE = /^[a-zA-Z0-9_-]+$/;

// A single port or a port range, e.g. "80" or "8000-8100". Each part 1-5 digits.
const PORT_RE = /^\d{1,5}(-\d{1,5})?$/;

// Transport protocol accepted by firewalld port/forward rules.
const PROTOCOL_RE = /^(tcp|udp)$/;

// Firewalld service name, e.g. "ssh", "http", "samba-client".
const SERVICE_RE = /^[a-zA-Z0-9_.-]+$/;

// Network interface / bridge name, e.g. "enp5s0.835", "ppp0", "localBridge",
// "eth0:1", "wlp11s0". Colons and @ appear on VLAN / alias / systemd names.
const INTERFACE_RE = /^[a-zA-Z0-9_.:@-]+$/;

// Systemd unit incl. its type suffix, e.g. "docker.service", "foo@bar.socket".
const SYSTEMD_UNIT_RE = /^[a-zA-Z0-9_.@:\\-]+\.(service|socket|timer|target|mount)$/;

// libvirt domain (VM) name — conservative allow-list; must not start with '-'.
const VM_NAME_RE = /^[a-zA-Z0-9_.-]+$/;

/**
 * Validates an IPv4 dotted-quad address (each octet 0-255).
 */
function isValidIPv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

/**
 * Ensures a single port number (no range) is within 1-65535.
 */
function isValidSinglePort(value: string): boolean {
  if (!/^\d{1,5}$/.test(value)) return false;
  const n = Number(value);
  return n >= 1 && n <= 65535;
}

export const Validators = {
  isZone: (v: string): boolean => typeof v === 'string' && v.length > 0 && v.length <= 64 && ZONE_RE.test(v) && !v.startsWith('-'),

  // Accepts a single port or an N-M range; every numeric part must be 1-65535.
  isPort: (v: string): boolean => {
    if (typeof v !== 'string' || !PORT_RE.test(v)) return false;
    return v.split('-').every(isValidSinglePort);
  },

  isSinglePort: (v: string): boolean => typeof v === 'string' && isValidSinglePort(v),

  isProtocol: (v: string): boolean => typeof v === 'string' && PROTOCOL_RE.test(v),

  isFirewallService: (v: string): boolean => typeof v === 'string' && v.length > 0 && v.length <= 64 && SERVICE_RE.test(v) && !v.startsWith('-'),

  isInterface: (v: string): boolean => typeof v === 'string' && v.length > 0 && v.length <= 64 && INTERFACE_RE.test(v) && !v.startsWith('-'),

  isSystemdUnit: (v: string): boolean => typeof v === 'string' && v.length > 0 && v.length <= 128 && SYSTEMD_UNIT_RE.test(v) && !v.startsWith('-'),

  isVmName: (v: string): boolean => typeof v === 'string' && v.length > 0 && v.length <= 64 && VM_NAME_RE.test(v) && !v.startsWith('-'),

  isIPv4: (v: string): boolean => typeof v === 'string' && isValidIPv4(v),

  // Rejects control characters (newlines, NUL, ...) that would break a config
  // file written line-by-line (e.g. hostapd SSID / passphrase).
  isConfigSafeLine: (v: string): boolean => typeof v === 'string' && !/[\x00-\x1f\x7f]/.test(v),
};

/**
 * Logs a rejection and returns false. Convenience for the common
 * "validate → log → refuse to execute" pattern in features.
 */
export function rejectInvalid(field: string, value: string, source: string): false {
  logger.error(`[validators] Rejected invalid ${field} from ${source}: ${JSON.stringify(value)}`);
  return false;
}

/**
 * Rendre une valeur utilisable comme segment d'un topic de découverte HA.
 *
 * Home Assistant n'accepte que [a-zA-Z0-9_-] dans chaque segment d'un topic
 * `homeassistant/.../config`. Tout le reste fait rejeter le message avec
 * « Received message on illegal discovery topic » — et c'est un échec
 * SILENCIEUX du point de vue de l'agent : la publication réussit, le broker
 * accepte, HA jette, et l'entité n'apparaît jamais.
 *
 * Le cas qui a motivé cette fonction, relevé en production le 2026-08-28 : la
 * zone firewalld par défaut s'appelle « internal (default) », espace et
 * parenthèses comprises. Huit entités du gestionnaire de pare-feu étaient
 * ignorées depuis toujours, sans une ligne d'erreur côté agent.
 *
 * Le remplacement est fait caractère par caractère, jamais par regroupement :
 * réduire une suite de caractères interdits à un seul « _ » ferait collider
 * deux identifiants voisins, et l'une des deux entités écraserait l'autre.
 */
export function sanitizeObjectId(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '_');
  // Un segment vide produirait « homeassistant/sensor/nivuus//config », que HA
  // rejette au même titre : mieux vaut un identifiant lisible qu'un trou.
  return cleaned.length > 0 ? cleaned : 'unnamed';
}
