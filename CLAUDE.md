# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Instructions for Claude

**IMPORTANT**: Whenever you learn something important about this project (architecture decisions, critical bugs fixed, configuration patterns, etc.), immediately update this CLAUDE.md file. Keep it:
- **Compact**: Dense, relevant information only
- **No duplicates**: Remove redundant information
- **Up-to-date**: Reflect current project state

**BE PROACTIVE**: When working on the codebase, actively look for improvements or issues beyond the current scope. If you spot bugs, performance issues, code smells, security concerns, or optimization opportunities - signal them to the user and fix them. Don't wait to be asked.

## Project Overview

**MQTT System Agent** — TypeScript monitoring agent that publishes system metrics to Home
Assistant via MQTT Discovery, and exposes host control surfaces (VM, firewall, WiFi, PPPoE)
as Home Assistant entities. Ships as a Debian package running under systemd.

Extracted from `nivuus/installer` on 2026-08-26. The host this agent monitors — its boot
chain, thermal policy, GPU passthrough, network and freeze history — stays documented in
that repository. The **Host Context** section below carries only the facts this agent's own
code depends on.

## MQTT System Agent Architecture

### Core Design Patterns

The MQTT agent uses a **feature-based architecture** with class inheritance:

- **BaseFeature** (`src/core/BaseFeature.ts`): Abstract base class that all monitoring features inherit from
- Each feature is self-contained with its own data collection, MQTT publishing, and Home Assistant discovery
- Features are registered in `src/core/Agent.ts` and enabled/disabled via `config/agent.yaml`

### Key Components

1. **Configuration System** (`src/config.ts`):
   - Singleton ConfigManager loads `config/agent.yaml`
   - Provides fallback configuration if loading fails
   - **IMPORTANT**: Error fallback uses same `device_info.identifiers` and `base_topic` as normal config to maintain Home Assistant entity consistency

2. **MQTT Client** (`src/mqtt/MqttClient.ts`):
   - Wrapper around `mqtt` npm package
   - Handles connection, reconnection, LWT (Last Will Testament)
   - All features use this wrapper, not the raw MQTT client

3. **Agent** (`src/core/Agent.ts`):
   - Main orchestrator that initializes MQTT client and all enabled features
   - Publishes inline Home Assistant discovery for alerts and events
   - Maps feature names to their classes in `availableFeatures`

4. **Features** (`src/features/`):
   - Each subdirectory represents a category (cpu, memory, disk, network, etc.)
   - Features must extend BaseFeature and implement abstract methods
   - Features self-register their Home Assistant entities via MQTT discovery

### MQTT Topic Structure

```
system_agent/                           # base_topic from config
├── {device_id}/                        # device_info.identifiers[0]
│   ├── status                          # Availability topic (online/offline)
│   ├── {feature_name}/                 # e.g., cpu_temperature
│   │   ├── {entity_id}/state           # Entity state
│   │   └── {entity_id}/attributes      # Entity attributes (JSON)
│   └── alert                           # Alert sensor
│   └── event                           # Event sensor

homeassistant/                          # HA Discovery prefix
└── {component}/{device_id}/{unique_id}/config
```

### Adding a New Feature

1. Create class extending BaseFeature in appropriate `src/features/` subdirectory
2. Implement required methods: `setupDiscovery()`, `update()`, `setupCommandHandlers()`
3. Add to `availableFeatures` map in `src/core/Agent.ts`
4. Add configuration to `config/agent.yaml`
## Development Commands

**Location**: All commands run from the repository root

```bash
# Build TypeScript to JavaScript
npm run build

# Start the agent (requires build first)
npm start

# Run tests
npm test

# Package as executable (Linux x64)
npm run package:executable

# Package as Debian package
npm run package:deb

# Development utilities
./list-entities.sh              # List Home Assistant entities
./clean-entities.sh             # Clean MQTT retained messages
./clean-restart.sh              # Clean restart with entity cleanup
```

**IMPORTANT**: The project is in development mode - do NOT install packages unless explicitly required.
## Deployment Workflow

**When a feature is complete**, follow this workflow to deploy:

```bash

# 1. Build the Debian package
npm run package:deb

# 2. Install the package
sudo dpkg -i mqtt-system-agent_1.0.0_amd64.deb

# 3. Restart the service to apply changes
sudo systemctl restart mqtt-system-agent.service

# 4. Check service status and logs
sudo systemctl status mqtt-system-agent.service
sudo journalctl -u mqtt-system-agent.service -f
```

## Configuration

### Main Config File

`config/agent.yaml` contains:
- MQTT broker connection (host: 192.168.0.1, port: 1883)
- Device info (identifiers, name, model) - **must match error fallback in config.ts**
- Feature enable/disable flags and update intervals

### MQTT Connection for Testing

```bash
# Subscribe to all Home Assistant discovery messages
mosquitto_sub -h 192.168.0.1 -t "homeassistant/#" -v -u mqtt -P CHANGE_ME_MQTT_PASSWORD

# Subscribe to all agent state topics
mosquitto_sub -h 192.168.0.1 -t "system_agent/#" -v -u mqtt -P CHANGE_ME_MQTT_PASSWORD
```

## Code Style Guidelines

From `.github/copilot-instructions.md`:

- **File Organization**: Maximum 200 lines per file - split if larger
- **Architecture**: Use classes and inheritance extensively
- **Modularity**: Each file should be self-contained and minimal
- **Comments**: English only
- **Logging**: Use logger for debugging, remove logs when no longer needed
- **Workflow**: Build → Start → Check logs → Fix → Repeat
- **Autonomy**: Be proactive - execute commands without asking for approval
- **System Adaptation**: Understand and adapt to the actual machine configuration

## Home Assistant Integration

The agent creates these entities in Home Assistant:

- **Sensors**: CPU temp per core, CPU load, memory usage, disk usage, network stats
- **Switches/Buttons**: VM control, firewall management, WiFi AP control
- **Diagnostic**: System updates, SMART disk status, connected devices, PPPoE credentials

All entities are linked to a single device in HA with:
- Device ID: `nivuus`
- Name: `Nivuus`
- Model: `System Agent v1.0`
## File Structure Key Points

```
.
├── src/
│   ├── core/              # Agent, BaseFeature, types
│   ├── features/          # All monitoring features (cpu, memory, disk, etc.)
│   ├── mqtt/              # MQTT client wrapper
│   ├── utils/             # Utilities (logger, exec, MAC vendor lookup)
│   ├── homeassistant/     # HA discovery services
│   ├── cli/               # CLI tools for sending alerts/events
│   └── config.ts          # Configuration manager (CRITICAL: maintains entity consistency)
├── config/
│   └── agent.yaml         # Main configuration file
├── dist/                  # Compiled JavaScript output
└── bin/                   # Executable wrapper
```

**`ha-dashboard/`** — the "Serveur" Home Assistant dashboard (strategy `custom:nivuus-server`,
plain ES modules, `npm run test:dashboard`). It finds entities by **unique_id**, so renaming an
entity's `unique_id` or `objectId` breaks it: run its tests (`test/fixtures/host.json`). See
`ha-dashboard/README.md` for deployment.

Topic notes in `docs/claude/`:
- `guest-vpn-host-notes.md` — guest VPN bench findings: firewalld reload failure (12:09 incident), NM/OpenVPN behaviour
- `guest-vpn-bench.md` — how to rebuild the isolated bench VM (`scripts/bench/`, not packaged)
- `guest-vpn-live.md` — live rollout on the router (2026-11-09): steps, outage and recovery timings

## Critical Implementation Notes

1. **Entity Consistency**: The `device_info.identifiers` must remain consistent between normal and error configurations to prevent duplicate Home Assistant entities

2. **Feature Registration**: Features must be added to `availableFeatures` map in `Agent.ts` to be discoverable

3. **Topic Prefixing**: BaseFeature automatically prefixes topics with `{base_topic}/{device_id}/` - don't manually add this prefix in features

4. **Discovery Publishing**: Features publish discovery messages to `homeassistant/{component}/{device_id}/{unique_id}/config` with retain flag
   - HA drops any discovery topic whose node_id/object_id is not `[a-zA-Z0-9_-]+` ("illegal discovery topic", silent for the agent). Always build the topic with `discoveryTopic()` / `BaseFeature.entityDiscoveryTopic()` (`src/homeassistant/discovery/discoveryTopic.ts`), never by string template: legal ids pass through unchanged, others get a readable part + an 8-hex SHA-256 digest of the raw value so distinct names (any script) never collide. Remove entities with `removeEntityDiscovery()` so removal hits the same topic.

5. **State vs Attributes**: Use separate topics for state (single value) and attributes (JSON object with additional data)

6. **Entity Naming Convention (CRITICAL)**:
   - **NEVER** include `${this.deviceInfo.name}` or `${baseName}` with device name in entity `name` field
   - Home Assistant automatically prepends the device name from `device.name` when generating `entity_id`
   - Adding device name manually creates duplicate prefixes like `sensor.nivuus_nivuus_cpu_temperature`
   - **Correct format**: `{Category} {Name} {Type}` (e.g., `"CPU Temperature"`, `"Network localBridge Device Count"`)
   - **Wrong format**: `${this.deviceInfo.name} {Category} {Name}` (creates "Nivuus Nivuus CPU Temperature")
   - Category prefixes to use: "CPU", "Memory", "Disk", "Network", "VM", "System", "Security", "Motherboard"
   - Always include descriptive type suffix: "Sensor", "Button", "Switch", etc.

7. **Glances Conflict (RESOLVED)**: There was previously an external Glances process publishing to MQTT that created 162 duplicate entities (sensor.glances_nivuus_*). This process has been stopped and entities removed. The mqtt-system-agent now handles all monitoring.

8. **MQTT Retained Message Cleanup**: When changing entity naming, use `clean_mqtt_retained.py` to clear all old discovery messages before restarting the service to avoid entity duplication in Home Assistant

## Feature-Specific Implementation Details

### WiFi/Hostapd Management (`src/features/wifi/`)

Split along its seams (2026-11-09): `securityProfiles.ts` (HA security types → hostapd lines,
validation), `hostapdConfigText.ts` (pure text edits of one radio file, unit-tested),
`hostapdService.ts` (file I/O, `systemctl reload|restart hostapd` with the real result),
`hostapdEntities.ts` (HA entity specs), `HostapdManager.ts` (MQTT wiring).

- One entity set per SSID (`network_<n>`: SSID, password, security, Apply, Delete, status);
  same SSID on both radios is merged. A rename keeps the numeric id.
- **Add network** form: SSID, password, security (default WPA2/WPA3-Mixed) and **bridge**
  (options = bridges found in the files; default = a bridge no radio's main network uses, i.e.
  the guest one). The new BSS copies `ctrl_interface`, `ap_isolate`, `access_network_type`
  and the 802.11k/v keys from an existing BSS on the same bridge. Interface name =
  radio `interface=` base + next free number. An empty form is refused (it used to create
  `NewNetwork`/`password123` on `localBridge`).
- **Apply** = `systemctl reload` (SIGHUP; every client re-associates, ~25 s); **add/delete** =
  `restart` (new or removed virtual interface, ~15 s outage). The last-action sensor shows
  "saved but NOT applied" when systemctl fails — `execute_argv` never throws, so check
  `exitCode`. Before 2026-11-09 the host unit had no `ExecReload` and every reload failed
  while HA said "reloaded successfully".
- Delete removes the whole `bss=` section; a radio's main network cannot be deleted.
- SSID limit is 32 **bytes** (UTF-8), not characters; SAE passwords may use any script, WPA2
  and mixed-mode passphrases must be 8-63 printable ASCII (802.11i).
- Known issues left open on purpose: `docs/claude/wifi-known-issues.md` (world-readable files
  after an HA change; passwords in retained MQTT states).
- Config paths: `/etc/hostapd/2.4Ghz.conf` and `/etc/hostapd/5Ghz.conf`.

### PPPoE Credentials Management (`src/features/network/PppoeCredentials.ts`)

**Key Features:**
- **NetworkManager integration**: Reads and writes credentials directly to `/etc/NetworkManager/system-connections/pppoe-enp6s0.835.nmconnection`
- **Real credential display**: Username and password are read from nmconnection file and displayed in Home Assistant
- **Connection restart**: Automatically reloads and restarts PPPoE connection after credential changes
- **No server field**: Previous "server" input was removed as it's not needed for PPPoE configuration

**Critical Implementation Points:**
- Password input uses `mode: 'password'`: Home Assistant renders an editable, masked input
  (verified on 2026-11-10 in the 2026.11 frontend; `mode: 'text'` showed it in clear on dashboards)
- Credentials are read with sudo due to nmconnection file permissions (600)
- INI-style parser for `[pppoe]` section: `username=` and `password=` lines
- After saving: `nmcli connection reload` + `nmcli connection down/up pppoe-enp6s0.835`
- Backup created before any modification: `{path}.backup`

**Legacy files not used:**
- `/etc/ppp/chap-secrets` and `/etc/ppp/pap-secrets` - monitored but not modified
- NetworkManager is the single source of truth for active PPPoE configuration

### Firewall Management (`src/features/firewall/FirewallManager.ts`)

**Key Features:**
- **Per-interface zone selection**: a select per relevant interface (bridges included:
  `relevantInterfacePatterns` OR `iface.includes('Bridge')`).
- **Rule command** `firewalld_manager/rule/set` (`firewallRules.ts`): JSON
  `{id, op: add|remove, zone, rule: {kind: service|port|forward, ...}}`, validated, then written
  `--permanent` and at runtime, **never `--reload`** (a live reload cut the LAN on 2026-11-09).
  Exit codes are checked. The answer is the last-action sensor: state `ready|ok|error`, attributes
  `{command_topic, result: {id, ok, failed?: invalid|permanent|runtime, detail?}}`; the dashboard's
  zone editor words it. Only the changed zone is re-read before answering. Interface moves use
  `--change-interface` the same way; the wizard handlers share these functions.
- The global port/service and forward forms were withdrawn on 2026-11-10 (`RETIRED_FORM_ENTITIES`).
- **Zone detail sensors** per active zone: forwards, services, ports (count + list attribute),
  masquerade (`--query-masquerade`: exit 1 = no, declared with `answerExitCodes`).

**Active Zones (Current Configuration):**
- **docker**: 5 interfaces, masquerade enabled, 7 port forwards to 192.168.3.2
- **external**: enp6s0.835 + ppp0, masquerade enabled, target REJECT, exposed services
- **home**: localBridge, target ACCEPT, 26 services, no masquerade
- **internal**: enp15s0 + internalBridge + vnet17 + enp14s0, 11 services
- **public**: publicBridge, masquerade enabled, target REJECT

### ClamAV detections (`src/features/events/EventMonitor.ts`, `clamavDetection.ts`)

- Source = **clamd's own log lines** (`clamd[pid]: <file>: <sig>[(hash:size)] FOUND`), live from
  the journal (`journalctl -f -n 0 -t clamd`), last one at startup from
  `journalctl -t clamd --grep 'FOUND$'`. **Not from `/var/log/syslog`**: rsyslog buffers that file
  (`OMFileFlushInterval 60` in the host's `/etc/rsyslog.d/00-reduce-disk-writes.conf`), which
  delayed alerts by up to a minute; `journalctl -f` delivers within a second. clamd sees
  every detection (clamdscan AND clamonacc, which delegates to clamd); `clamonacc.log` only ever
  saw on-access ones and its last 100 lines kept hours, not weeks. Published as event type
  `clamav_virus` → topic `.../events/clamav_virus` + sensor `last_clamav_virus_event`.
- clamd writes each detection **twice** in the same second → `DetectionDeduper` (5 s window).
- Do NOT go back to ClamAV's `VirusEvent`: clamd runs it as user `clamav` under its AppArmor
  profile, which denies `execve(/bin/sh)`; the agent binary (pkg, mode 751) is unreadable by
  `clamav`; ClamAV ≥ 1.0 replaces `%f` with a fixed warning sentence. Removed on 2026-11-09.

### Guest VPN (`src/features/vpn/`, key `guest_vpn`)
Routes the `publicBridge` guest network through an OpenVPN tunnel. Entities: `ENTITIES.md`; bench
findings and the firewalld incident: [docs/claude/guest-vpn-host-notes.md](docs/claude/guest-vpn-host-notes.md).
- Config (`config/agent.yaml`): `update_interval_seconds` 15, `bridge: publicBridge`, optional `state_file`.
- NM profile `nivuus-guest-vpn`, always addressed by UUID; staging copies use the basenames `_a`/`_b`.
- Tunnel `nvguest0` (dev-type tun), routing table 200, `ip rule`s on `iif publicBridge`. The tun sits
  in the existing zone `external`: no zone or policy of its own, and the agent never calls `firewall-cmd`.
- nft table `inet nivuus_guest_vpn` (guest DNS DNAT) is owned and rewritten by the agent only.
- The owner's on/off choice lives in `/var/lib/mqtt-system-agent/guest-vpn.json`; the supervisor
  enforces it every tick in both directions (up when wanted, down when not). Failed activations back
  off (15 s doubling, cap 5 min, `next_attempt` attribute; reset by a switch command or an import).
- `connected` = NM activated **and** healthy (`tunnelHealth.ts`): default route via `nvguest0` in
  table 200, rule 100 `iif publicBridge lookup 200`, and the first pushed IPv4 DNS answers a root NS
  query from a socket bound to the tun (`dnsProbe.ts`, python3 `SO_BINDTODEVICE`; `dig -b` would
  follow the main table out of the uplink). NM can stay "activated" after OpenVPN reopened the tun and
  NM lost table 200 (bench), and `curl --interface` still succeeds then. The DNS DNAT follows health;
  the ipify exit IP is reported only. Two unhealthy ticks in a row → `down()`, next due tick `up()`.
- Expected guest fallback when the provider dies silently: DNS table emptied on the first failing
  tick, tunnel down on the second, so guests are on Orange 15–30 s (+ up to 2×3 s probe timeouts)
  after the outage; OpenVPN alone (`ping-restart` 120 s + `ping-exit` 60 s) took ~3 min.
- Rule 99 `iif publicBridge lookup main suppress_prefixlength 0` lets guest traffic to any on-link or
  more specific main-table prefix (the WAN /23, Docker pools, other LANs) bypass the tunnel; guest
  isolation from those networks is firewalld's job, not the routing's.
- The tunnel address is reachable inbound for whatever zone `external` opens: same exposure as the
  WAN (ruled trade-off of joining `external` rather than a zone of its own).
- State enum values (`connected`, `no_config`...) are codes shown untranslated in HA: MQTT discovery
  has no translation keys.
- `prerm` on `remove` (not `upgrade`) takes the profile down and deletes the nft table, guarded.
- WebSocket: `vpn.import_profile` (uploads the `.ovpn`; never over MQTT) and `vpn.get_status`.
- **Never reload firewalld live.** On 2026-11-09 (12:09) a `firewall-cmd --reload` cut the home LAN
  (see host notes); this includes `FirewallManager` and the wizard handlers. Restart-time only.
- Package depends on `network-manager-openvpn`, `python3` (DNS probe) and `iproute2` (`package:deb`).
- Tick commands that only read (`nmcli connection show`, `ip -j`, probes) pass `quiet` to `execute_argv`
  (attempt logged at debug); every other caller keeps the info line.

### Common Patterns Across Features

**Input entity initialization:**
- Text entity states go through `publishTextState()`: retained `{"value": "..."}`, read by the
  `value_template` that `publishEntityDiscovery('text', …)` adds. Never publish a raw `''`: an empty
  **retained** payload deletes the retained message (MQTT spec), so after any HA reconnection the
  field showed the word "unknown". HA's birth message is not enough on its own: HA sends it before
  its entities resubscribe, so only retained values reach them.
- `src/core/haBirth.ts` answers HA's birth message (`homeassistant/status` = `online`) by restarting
  every feature, through the same serialized path as an MQTT reconnection, so non-retained states
  come back at once.
- MQTT message handlers are registered with `listenToMessages()`, which `stop()` removes. A raw
  `mqttClient.on('message')` in `setup()` adds one more handler at every restart, so each command ran
  once per reconnection.
- Publish states AFTER publishing discovery entities
- Use `mode: 'password'` for password fields: they stay editable, masked on screen

**MQTT message handling:**
- Store pending changes in memory until "Apply" button is pressed
- Echo back state changes immediately for UI responsiveness
- Use atomic file operations: backup → temp → move → reload service

**Error handling:**
- `execute_argv` never rejects and logs any non-zero exit at warn. A command whose exit code
  is the answer (`firewall-cmd --query-*`: 1 = no) passes `answerExitCodes: [1]`, and the caller
  still treats any other code as a failure.
- WinRM goes through `winrm-client` (`src/utils/winrm.ts`), which rejects on failure. Its
  abandoned ancestor `nodejs-winrm` *returned* the Error, which callers then parsed as output.
- Publish error messages to `{feature_name}/last_action/state` sensor
- Log errors with logger.error() for debugging
- Validate inputs before executing system commands

## Host Context (minimum this agent depends on)

The full infrastructure documentation lives in `nivuus/installer`. Repeated here are only
the host facts the agent's own features read or write — enough to work on this repository
without opening the other one.

**Shell gotchas (sessions run as root on the live server):**
- The interactive zsh profile ships broken `localip`/`grep`/`ip` functions (`FUNCNEST`
  errors): commands intermittently hang ~2 min, get killed (exit 137/143), or have their
  output silently eaten. **Wrap commands in `bash -c '...'`**, or read `/sys` directly.
- **`systemctl` does NOT work from a Claude session**: the session runs in its own PID
  namespace, and systemd authenticates peers with `SO_PEERCRED`, so every call fails with
  `Failed to connect to system scope bus via local transport: No data available`. It
  **fails silently for query subcommands** — an empty result may mean *unreachable*, not
  *unset*. Drive systemd over the D-Bus system bus instead (`dbus-send` authenticates by
  UID, which is namespace-independent):
  ```bash
  M="--system --print-reply --dest=org.freedesktop.systemd1 /org/freedesktop/systemd1 org.freedesktop.systemd1.Manager"
  dbus-send $M.Reload
  dbus-send $M.RestartUnit string:"mqtt-system-agent.service" string:"replace"
  ```
  `journalctl`, `/sys`, `/proc` and writes to `/sys` all work normally.

**MQTT broker credentials are NOT in this repository.** `config/agent.yaml` ships
`CHANGE_ME_MQTT_PASSWORD`, and a `.deb` install overwrites the deployed copy. The real
credentials live in the systemd drop-in
`/etc/systemd/system/mqtt-system-agent.service.d/mqtt-credentials.conf`
(`Environment=MQTT_USERNAME/MQTT_PASSWORD`, mode 600). `config.ts` applies these as
overrides, so **they survive package upgrades** — after any `dpkg -i`, the config
placeholder is back but the env drop-in still wins.

**NUT credentials follow the same rule** (`NUT_USERNAME`/`NUT_PASSWORD` in
`/etc/mqtt-system-agent.env`, read by `src/features/ups/nutCommands.ts`). The upsd user is
`mqtt-agent`, restricted in `/etc/nut/upsd.users` to `test.battery.start.quick` and
`test.battery.stop` — never give it `instcmds = ALL`, which includes `load.off` (cuts the
host's power). The battery test command is picked from `upscmd -l`, because models differ:
the APC Back-UPS BX1600MI has no plain `test.battery.start`, only `.quick` and `.deep`.

**Wizard WebSocket token follows the same rule** (`NIVUUS_WS_TOKEN` in
`/etc/mqtt-system-agent.env`, ≥ 32 chars, `openssl rand -hex 32`). The channel
(`src/websocket/`) runs root-level actions for the HA `nivuus_wizard` integration, so
`serverConfig.ts` refuses to start it (agent keeps running, error logged) with a missing,
placeholder (`CHANGE_ME*`, `${VAR}`) or short token, or `auth.type` other than `token`. It
binds `127.0.0.1:8766` by default: HA runs with `network_mode: host`, so its integration must
use host `127.0.0.1` (its default `192.168.0.1` no longer answers). Tokens are compared in
constant time, a failed or late (10 s) auth closes the socket, messages are capped at 1 MiB,
and any browser `Origin` not in `allowed_origins` is refused with 403.
`WizardHandler.ts` is only the router (own-property action lookup); each feature's actions
live in `src/websocket/wizard/<feature>Handlers.ts`, the hostapd path allowlist in `hostapdConfig.ts`.

**Periodic quick battery test** (`src/features/ups/batteryTestSchedule.ts`): every
`battery_test_interval_days` (default 30, 0 = off), only when `ups.status` carries the
`OL` flag without `OB`/`LB` and the charge is ≥ 90 %. The last accepted run is stored in
`/var/lib/mqtt-system-agent/ups-battery-test.last` (survives `dpkg -i`); a refused start is
not recorded and is retried a day later. The outcome is `ups.test.result`, published as
the diagnostic sensor `UPS Battery Test Result`. On the BX1600MI a running test reads
`OL DISCHRG`, not `OB`.

**Files the features read and write:**

| Feature | Path |
|---|---|
| `HostapdManager` | `/etc/hostapd/2.4Ghz.conf`, `/etc/hostapd/5Ghz.conf` |
| `PppoeCredentials` | `/etc/NetworkManager/system-connections/pppoe-enp6s0.835.nmconnection` (mode 600, needs sudo) |
| `FirewallManager` | `firewall-cmd` (firewalld, **nftables** backend) |
| `GuestVpn` | `/var/lib/mqtt-system-agent/guest-vpn.json` (on/off choice), NM profile `nivuus-guest-vpn` (`nmcli`), nft table `inet nivuus_guest_vpn`, routing table 200 + `ip rule` on `iif publicBridge` |
| `VmManager` | `virsh` on domain `Windows` |

**firewalld uses the nftables backend** — `iptables -t nat -S` looks empty but isn't; check
`nft list table inet firewalld`. A `firewall-cmd --reload` rebuilds only
`table inet firewalld` and never foreign tables (`f2b-table`, `crowdsec`,
`inet nivuus_smb`), which is why the FirewallManager's reloads are safe.

**`ppp0` is dynamic** and is placed in the `external` zone by
`/etc/ppp/ip-up.d/firewalld-external` on every link-up.

**`virsh` output is localized** — scripts must use `LC_ALL=C`. And **plain `virsh shutdown`
does not deliver the ACPI event** on libvirt 11.x without a guest agent: stop/restart pass
`--mode acpi`, the only reliable path (`virsh destroy` is the forceful fallback). The argv
lives in one place, `src/features/vm/virshLifecycle.ts`, shared by `VmManager` and the
wizard's vm handlers; `runVmAction` throws when virsh fails (`execute_argv` never rejects).

**`postinst` enables the unit by name** (`systemctl enable mqtt-system-agent.service`), never
by path: enabling `/lib/systemd/system/...` links a foreign unit into `/etc/systemd/system`,
and `dpkg -P` then fails (reproduced and fixed on the bench, 2026-11-09). `postinst.sh` runs on
install and upgrade (`--after-install` and `--after-upgrade`), so an upgrade repairs an old
path-enabled host. fpm calls the `prerm.sh` body with no arguments, on removal only: never
test `$1` there.

**RF coexistence (do not break):** hostapd 2.4 GHz is **pinned to channel 6** with `[HT40+]`
deliberately removed, because Zigbee sits on ch 25 (2475 MHz) and Thread on ch 21
(2455 MHz). ACS or a 40 MHz secondary channel would cover them. 5 GHz is ch 36, VHT80.
`systemctl reload hostapd` (SIGHUP) applies SSID/security changes but **cannot** apply
channel or BSS changes — those need a `restart` (~15 s outage, clients re-attach automatically).
Host-side Wi-Fi setup (unit, post-start isolation/txpower/802.11k unit) is documented in
`nivuus/installer` `configs/network/hostapd-config.md`.

**Deployment target**: the agent runs on the Nivuus host as `mqtt-system-agent.service`,
with device ID `nivuus` in Home Assistant.
