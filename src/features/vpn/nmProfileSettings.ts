/**
 * What the guest VPN profile looks like in NetworkManager: the configuration and the settings
 * applied after import.
 *
 * Every value comes from the bench (docs/claude/guest-vpn-host-notes.md, steps 3 to 5).
 */

export interface GuestVpnConfig {
  /** Guest bridge: activation base device and policy-rule selector. */
  bridge: string;
  /** NM connection id of the live profile; uploads are staged as `<id>_a` / `<id>_b`. */
  connectionId: string;
  /** Fixed tun name, so the permanent firewalld binding in external.xml can name it. */
  device: string;
  /** Routing table holding the tunnel routes. */
  table: number;
  /** Existing firewalld zone the tun joins (masqueraded uplink). */
  zone: string;
  /** Where the owner's on/off choice is persisted. */
  stateFile: string;
}

export const DEFAULT_GUEST_VPN_CONFIG: GuestVpnConfig = {
  bridge: 'publicBridge',
  connectionId: 'nivuus-guest-vpn',
  device: 'nvguest0',
  table: 200,
  zone: 'external',
  stateFile: '/var/lib/mqtt-system-agent/guest-vpn.json',
};

/**
 * OpenVPN exits after this many seconds without traffic from the server (after its pushed
 * ping-restart fires), so NM drops the VPN and its rules: guests fall back at once and the
 * state NM reports stays truthful. The agent's supervisor brings the tunnel back.
 */
export const PING_EXIT_SECONDS = 60;

/**
 * Arguments of `nmcli connection modify` after import. Deliberately absent: the username
 * and password (written to the keyfile, never argv), `connection.autoconnect yes` (NM does
 * not autoconnect VPN profiles; the agent supervises), and anything on the bridge's own
 * profile (no `connection.secondaries`).
 */
export function profileSettingsArgs(cfg: GuestVpnConfig): string[] {
  const { bridge, device, table, zone } = cfg;
  return [
    'connection.autoconnect', 'no',
    'connection.zone', zone,
    // nm-openvpn infers tun/tap from the name prefix; a custom name needs dev-type too.
    '+vpn.data', `dev=${device}`,
    '+vpn.data', 'dev-type=tun',
    '+vpn.data', `ping-exit=${PING_EXIT_SECONDS}`,
    'ipv4.route-table', String(table),
    'ipv6.route-table', String(table),
    'ipv4.never-default', 'no',
    'ipv4.routing-rules',
    `priority 99 iif ${bridge} table main suppress_prefixlength 0, `
      + `priority 100 iif ${bridge} table ${table}, priority 101 oif ${device} table ${table}`,
    'ipv6.routing-rules', `priority 100 iif ${bridge} table ${table}`,
    'ipv6.routes', `::/0 table=${table} type=unreachable`,
    // The provider pushes IPv6 routes that would carry guest IPv6 into the tunnel un-NATed.
    'ipv6.ignore-auto-routes', 'yes',
  ];
}
