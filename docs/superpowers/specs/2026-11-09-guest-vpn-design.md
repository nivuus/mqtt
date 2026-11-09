# Guest network VPN (OpenVPN) — design

Date: 2026-11-09. Status: draft, awaiting owner approval.

## Intent

Guests on the public Wi-Fi / Ethernet network (`publicBridge`, 192.168.2.0/24, firewalld zone
`public`) should reach the internet through a commercial OpenVPN provider instead of the
household's Orange public IP. The owner manages the VPN from Home Assistant on a phone: upload a
`.ovpn` file, enter the provider credentials, turn it on or off. Nothing changes for the home LAN
(`localBridge`), the internal network, the server itself, containers or VMs.

Owner's reason (confirmed): guests' online activity — including which sites they look up, i.e.
DNS — must not be attributed to the household's Orange IP while the VPN is up.

Every device on `publicBridge` is a guest device (confirmed): the whole network goes through the
VPN, with no per-device exception.

## Goals

1. All guest traffic leaving `publicBridge` for the internet goes through the OpenVPN tunnel while
   the VPN is enabled and up — IPv4, and DNS resolution too (see "Leaks").
2. The owner can, from the HA mobile app:
   - upload a `.ovpn` file (replaces the current one; there is only ever one VPN);
   - set the provider username and password;
   - enable / disable the guest VPN;
   - see the tunnel state and the current exit IP.
3. Uploading a new `.ovpn` takes effect without any other action (if the VPN is enabled, it
   reconnects with the new file).
4. If the tunnel drops or cannot connect, **guests fall back to the normal Orange connection**
   (owner's explicit choice — no kill switch) and the VPN **keeps retrying indefinitely** until it
   is back. Guests then return to the tunnel automatically.

## Non-goals

- Several VPN profiles, choosing a server/country from HA, per-device routing inside the guest
  network: out of scope. One file, whole network.
- Putting `localBridge` or any other network behind the VPN. The design must not prevent it later
  (the network should be a parameter, not a hardcoded string scattered in code), but no UI for it.
- WireGuard, a self-hosted VPN server, inbound access through the VPN.
- Replacing Gluetun (containers only, unrelated).

## Anti-goals (failure even if it "works")

- The home LAN, the server's own traffic, Docker, Pomerium, Plex, the console VM or the 4G
  fallback start routing through the VPN, or break, when the VPN goes up or down.
- The VPN password or the `.ovpn` private material ends up in HA entity states, HA history,
  recorder, logs, MQTT retained messages or the agent's logs.
- A silent failure: the tunnel is down / guests are on Orange and HA still shows "connected".
  The state shown must reflect reality (exit IP measured, not assumed).
- Guests lose internet for more than a few seconds when the tunnel goes up or down.
- A `firewall-cmd --reload` (triggered by the mqtt FirewallManager) or a NetworkManager restart
  silently drops the guest routing so guests leave through Orange while the VPN is "up".
- Anything in this feature — install, enable, disable, profile upload, agent restart, tunnel
  failure — cuts or degrades internet on `localBridge` or on the host itself (owner's explicit
  requirement after the 2026-11-09 incident).

## Safety on the live host (added after the 2026-11-09 incident)

On 2026-11-09 12:09 a firewalld change made during a host spike failed
(`python-nftables failed: Could not process rule: No such file or directory`) and left the
router firewalled shut: `localBridge` lost internet until the owner rebooted. The failing
transaction rebuilt existing zone chains (including policy `docker-forwarding`, which also logs
`NAME_CONFLICT` at every boot), not the new objects. Root cause not yet known. Owner's rule:
**do not break internet on `localBridge`.** Therefore:

- The agent never reloads firewalld and never creates zones or policies. The tunnel joins the
  existing zone `external` (`connection.zone external` on the VPN profile): it is an uplink like
  the Orange WAN, already masqueraded, and policy `internet-traffic` (ANY → external, ACCEPT)
  already allows guest egress through it. No new firewalld object exists in this design.
- Even binding an interface to a zone is a firewalld runtime change. Before any such change
  happens on the live host, the 12:09 failure must be understood and shown not to recur
  (bench first, see plan Task 1).
- Every step on the live host runs behind a dead-man switch: a transient systemd timer armed
  first that reverts the step (`nmcli connection down`/`delete` of the VPN profile, `nft delete
  table` of the agent's table) unless explicitly disarmed after `localBridge` internet is verified.
- `localBridge` internet (a `localBridge`-sourced HTTP request, plus the host's own) is checked
  before, during and after each live step.

## Constraints and facts

- Provider: **ZoogVPN**. It ships `.ovpn` files plus username/password (`auth-user-pass`). Its
  Linux guide also mentions a separate `ca.crt`; some files may embed `<ca>` inline, others not.
  IPv6 support of ZoogVPN is unknown.
- Host: Debian, NetworkManager owns every interface; firewalld (nft backend) owns filtering.
  `publicBridge` is `ipv4.method shared` (NM's dnsmasq serves DHCP/DNS). The shared dnsmasq config
  in `/etc/NetworkManager/dnsmasq-shared.d/` currently hands **192.168.0.1 as DNS** to clients:
  guest DNS is resolved by the host and egresses via Orange today.
- WAN is DHCP on `enp5s0.832` (zone `external`), PPPoE `ppp0` as fallback, plus a USB 4G fallback
  profile. Policy `internet-traffic` accepts ANY → external.
- IPv6: a /56 is delegated and IPv6 is distributed to the LANs (memory, 2026-10-11). Whether
  `publicBridge` currently gets global IPv6 must be checked on the host before building.
- HA runs in Docker (`/opt/nivuus/home-manager/config`). MQTT discovery entities cannot upload
  files, and MQTT `text` entities are limited to 255 characters, so the `.ovpn` cannot go through
  an MQTT entity. HA core has a file field for config/options flows (`selector.FileSelector`,
  uploaded through the `file_upload` integration, read with `process_uploaded_file`) that works in
  the mobile app. Verify the current API in HA core source before use.
- Precedent: the `nivuus_wizard` HA integration already talks to this agent over the agent's
  WebSocket server (`src/websocket/WizardHandler.ts`), with an allowlist of files the agent may
  write.
- Suite rules: English code, no file over 500 lines, fix causes not symptoms, prefer existing
  tools over homegrown ones.

## Decided

| Topic | Decision | By |
|---|---|---|
| Protocol | OpenVPN | owner |
| Scope | whole `publicBridge` network | owner |
| Provider | ZoogVPN, `.ovpn` + username/password | owner |
| Tunnel down | guests fall back to Orange, VPN retries forever | owner |
| "Modify" | re-upload a `.ovpn` file, nothing finer | owner |
| Where managed | HA, from the phone | owner |
| Tunnel management | NetworkManager + `network-manager-openvpn` (import the `.ovpn`, store secrets in the system connection with `password-flags=0`, root-only file); not a hand-run `openvpn` daemon | Claude |
| Routing | policy routing: tunnel routes in a dedicated table, rule `from 192.168.2.0/24 lookup <table>`; nothing changes in the main table. When the tunnel is down the table is empty / rule falls through to main → Orange (that *is* the fallback) | Claude |
| Provider pushed routes | ignore `redirect-gateway` for the main table (`ipv4.never-default` / route-table on the VPN connection) so the server itself never routes through the VPN | Claude |
| Retry | bench (2026-11-09) showed NM never autoconnects a VPN profile and never re-activates it after OpenVPN exits. Owner approved (2026-11-09): the profile uses `ping-exit` so a dead tunnel goes down cleanly (guests fall back to Orange, state is truthful), and the agent supervises: every update tick (15 s), if the owner enabled the VPN and the profile is not active, it runs `nmcli connection up`. The desired on/off state is the agent's, persisted under `/var/lib/mqtt-system-agent/`. Every attempt and failure is visible in HA (`connecting`, `error` + last error) — supervision, not a loop that hides failures | owner |
| Profile settings from the bench | `vpn.data dev=nvguest0` **and** `dev-type=tun`; activation with `ifname publicBridge` (the WAN is not NM-managed, so NM needs a base device); `ipv6.ignore-auto-routes yes` (ZoogVPN pushes IPv6, which otherwise bypasses the IPv6 block) | Claude, bench |
| Tun zone across reloads | NM's zone binding of `nvguest0` is lost on firewalld reload/restart (guests blackholed). A permanent `<interface name="nvguest0"/>` in `external.xml`, consistent with the profile's `connection.zone external` (never contradicting it — a contradicting line caused the 12:09 incident), keeps it. Shipped by `installer` | Claude, bench |
| Credentials input | same HA form as the file upload, password field; the HA side forwards them to the agent and does **not** persist them in its config entry | Claude |
| Tunnel firewall zone | existing zone `external` via `connection.zone`; no own zone, no own policy, no reload ever | Claude, after incident |
| Optional CA file | the HA form accepts an optional second file (`ca.crt`) for providers that ship it separately | Claude |
| Exit IP | measured by the agent through the tunnel (bind to the tun device), not inferred | Claude |
| Every device on the guest network | goes through the VPN, no exception | owner |
| WAN fallbacks | the guest VPN keeps running on every uplink (DHCP 832, PPPoE, USB 4G); no WAN-aware gate. The tunnel endpoint simply follows the main table | owner |
| Guest DNS | the resolver address handed to guests never changes. While the tunnel is up, the agent's own nft table (`inet nivuus_guest_vpn`, a foreign table like `inet nivuus_smb`, untouched by `firewall-cmd --reload`) DNATs every guest DNS query (udp/tcp 53, any destination) to the provider DNS pushed by OpenVPN; the DNATed packet is then forwarded, so the policy rule sends it through the tunnel. IPv6 DNS from guests is rejected while up so clients use IPv4. Table emptied when the tunnel is down. Avoids fighting DHCP leases and client DNS caches | Claude |
| Rule selector | rules match `iif publicBridge` (not the subnet), so they also cover the guests' IPv6, whose delegated prefix is dynamic. Rules and routes belong to the VPN NM profile, so they exist exactly while the tunnel is up — the fallback needs no code | Claude |
| Guest IPv6 while up | if ZoogVPN carries no IPv6 (expected), the VPN table holds an IPv6 `unreachable` default: guests get an immediate ICMPv6 error and Happy Eyeballs falls back to IPv4 through the tunnel. Nothing to change in `nivuus-wan-orange-lan6` | Claude |
| Guests → other local subnets | the guest network stays isolated from the home networks (existing guest isolation, 2026-11-08); policy rule must still let replies and host services on 192.168.2.1 (DHCP, DNS) work, e.g. a higher-priority `lookup main suppress_prefixlength 0` rule | Claude |
| HA integration | no versioned source exists for `nivuus_wizard` (no repo; only a copy under HA's `custom_components`), so the upload lives in a **new small integration** (`nivuus_vpn`, options flow, admin-only as HA options flows are), versioned in `home-manager`, which owns the HA config | Claude |
| Upload channel auth | reuse the agent's WebSocket server: since mqtt #33 (deployed 2026-11-09) it listens on `127.0.0.1:8766` only, token from `NIVUUS_WS_TOKEN`; HA (network_mode host) connects to `127.0.0.1` | Claude |
| File size limit | the mqtt repo's own rule is 200 lines per source file (stricter than the suite's 500); the agent feature is split accordingly | repo rule |

## Leaks the builder must close

- **DNS**: while the VPN is up, guests' DNS must be resolved through the VPN (see "Guest DNS"
  above). Today guests get 192.168.0.1 as resolver, which egresses via Orange: that must change.
  Guests must also not bypass it with a hardcoded resolver (8.8.8.8, DoT on 853): plain DNS to
  any address is caught by the policy route anyway since it leaves through the tunnel; the
  builder checks it. When the VPN is down, guest DNS falls back like the rest.
- **IPv6**: if guests have global IPv6, it bypasses an IPv4-only tunnel. If ZoogVPN does not carry
  IPv6, guests must not get global IPv6 while the VPN is up (e.g. stop advertising it on
  `publicBridge`, or reject public → external IPv6 so clients fall back to IPv4 fast). Pick the
  option that gives guests the fastest fallback, and say which in the plan.
- **Firewall**: traffic from zone `public` must be allowed to egress through the tun interface:
  the tun is bound to the existing zone `external` (masquerade, `internet-traffic` policy) by its
  NM profile — no new zone or policy (see "Safety on the live host"). Must survive a firewalld
  restart (NM re-binds the interface).

## HA side

- Entities (via MQTT discovery from the agent, like the other features):
  - `switch` — guest VPN enabled;
  - `sensor` — state: `connected`, `connecting`, `disabled`, `no_config`, `error` (guests on
    Orange whenever not `connected`), with the last error as an attribute;
  - `sensor` — current guest exit IP (as seen from the internet), plus the profile's remote server
    as an attribute;
  - `binary_sensor` (optional) — guests currently on Orange.
- Upload: an HA config/options flow with a file field (`.ovpn`), an optional CA file, username,
  password, in the new `nivuus_vpn` integration (see "Decided"). It sends them to the agent over
  the existing WebSocket channel and its token.
- All user-facing strings in English in code, translated through HA's `strings.json` /
  `translations/`, not hardcoded in one language.

## Agent side (this repo)

- New feature under `src/features/` (e.g. `vpn/`), registered in `Agent.ts` and `config/agent.yaml`;
  the guest network (bridge + subnet) comes from config, not constants.
- WebSocket actions: `import_profile` (file contents + optional CA + credentials), and the switch
  command over MQTT. Validate the `.ovpn` before importing: reject directives that run commands or
  scripts (`up`, `down`, `script-security` > 1, `plugin`, etc.) — the file comes from a phone and
  is applied as root.
- Write only through NetworkManager (nmcli / D-Bus), never arbitrary paths.
- Do not log the password or the file's key material.
- Packaging: add `network-manager-openvpn` to the `.deb` dependencies. The host-side routing rule
  and firewall pieces belong where the rest of the host network config lives (`installer` repo)
  if they must exist independently of the agent; the builder decides and states it in the plan.

## Left to the builder

- Exact routing table number, rule priority, NM property names (check current
  NetworkManager / nm-openvpn docs).
- How to detect state transitions (NM D-Bus signals vs polling `nmcli`).
- Exit IP service and refresh interval.
- Whether the `ca.crt` is merged into the profile or stored alongside.
- Test strategy; at minimum an end-to-end check from a real guest device: exit IP = ZoogVPN while
  up, = Orange after stopping the tunnel, DNS resolver seen by a leak test, no IPv6 leak.

## Done means

From a phone on the guest Wi-Fi: an IP check site shows a ZoogVPN IP and a DNS leak test shows no
Orange resolver; IPv6 test shows no Orange address. Stop the tunnel (or block the provider) →
guests still browse within seconds, HA shows "on Orange", and the VPN reconnects by itself when
the provider is reachable again. From a device on `localBridge`, and from the server, the exit IP
stays Orange throughout. Re-uploading a different `.ovpn` from HA switches servers with no other
action.
