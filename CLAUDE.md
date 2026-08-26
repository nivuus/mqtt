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

## Critical Implementation Notes

1. **Entity Consistency**: The `device_info.identifiers` must remain consistent between normal and error configurations to prevent duplicate Home Assistant entities

2. **Feature Registration**: Features must be added to `availableFeatures` map in `Agent.ts` to be discoverable

3. **Topic Prefixing**: BaseFeature automatically prefixes topics with `{base_topic}/{device_id}/` - don't manually add this prefix in features

4. **Discovery Publishing**: Features publish discovery messages to `homeassistant/{component}/{device_id}/{unique_id}/config` with retain flag

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

### WiFi/Hostapd Management (`src/features/wifi/HostapdManager.ts`)

**Key Features:**
- **Per-network configuration**: Each WiFi network (SSID) gets its own set of 6 entities:
  - Text inputs for SSID name and password (mode: text for visibility)
  - Select dropdown for security type (WPA2-PSK, WPA3-SAE, WPA2/WPA3-Mixed, Open)
  - Apply and Delete buttons
  - Status sensor showing active bands (2.4GHz, 5GHz, or both)
- **Numeric network IDs**: Uses `network_1`, `network_2`, etc. instead of sanitized SSID names to avoid special character issues
- **Dual-band merging**: Networks with same SSID in both 2.4GHz and 5GHz configs are merged into single entity set
- **Config file preservation**: All hostapd parameters (bridge, interface, access_network_type) are preserved when updating networks
- **Security type mapping**: Complete mapping from HA select options to hostapd config parameters (wpa, wpa_key_mgmt, rsn_pairwise, etc.)

**Critical Implementation Points:**
- Password inputs use `mode: 'text'` not `mode: 'password'` for editability
- Entity IDs use numeric counter (1, 2, 3...) to avoid special characters in SSID names
- Changes are applied atomically: backup → temp file → atomic move → reload hostapd
- Config paths: `/etc/hostapd/2.4Ghz.conf` and `/etc/hostapd/5Ghz.conf`

### PPPoE Credentials Management (`src/features/network/PppoeCredentials.ts`)

**Key Features:**
- **NetworkManager integration**: Reads and writes credentials directly to `/etc/NetworkManager/system-connections/pppoe-enp6s0.835.nmconnection`
- **Real credential display**: Username and password are read from nmconnection file and displayed in Home Assistant
- **Connection restart**: Automatically reloads and restarts PPPoE connection after credential changes
- **No server field**: Previous "server" input was removed as it's not needed for PPPoE configuration

**Critical Implementation Points:**
- Password input uses `mode: 'text'` not `mode: 'password'` for editability
- Credentials are read with sudo due to nmconnection file permissions (600)
- INI-style parser for `[pppoe]` section: `username=` and `password=` lines
- After saving: `nmcli connection reload` + `nmcli connection down/up pppoe-enp6s0.835`
- Backup created before any modification: `{path}.backup`

**Legacy files not used:**
- `/etc/ppp/chap-secrets` and `/etc/ppp/pap-secrets` - monitored but not modified
- NetworkManager is the single source of truth for active PPPoE configuration

### Firewall Management (`src/features/firewall/FirewallManager.ts`)

**Key Features:**
- **Per-interface zone selection**: Each network interface (including bridges) gets a dropdown to change its firewall zone
- **Port forward management**: Full CRUD interface for port forwarding rules with 5 inputs:
  - Source port, destination IP, destination port, protocol (tcp/udp), zone
  - Add and Remove buttons execute firewall-cmd commands
- **Zone detail sensors**: For each active zone, displays:
  - Port forwards count + detailed list (port→toaddr:toport)
  - Services count + list
  - Open ports count + list
  - Masquerading status (binary sensor ON/OFF)
- **All interfaces included**: Pattern `relevantInterfacePatterns` OR `iface.includes('Bridge')` captures:
  - Standard interfaces: enp6s0.835, ppp0, enp15s0, enp14s0
  - Bridges: localBridge, internalBridge, publicBridge

**Critical Implementation Points:**
- Interface zone changes are atomic: remove from old zone → add to new zone → reload
- All changes use `--permanent` flag + `firewall-cmd --reload`
- Port forward format: `port=X:proto=Y:toport=Z:toaddr=A`
- Zone details updated every 5 minutes in `update()` cycle
- Empty string states published for all inputs to avoid "unknown" values
- Bridge detection: `iface.includes('Bridge')` catches localBridge, internalBridge, publicBridge

**Active Zones (Current Configuration):**
- **docker**: 5 interfaces, masquerade enabled, 7 port forwards to 192.168.3.2
- **external**: enp6s0.835 + ppp0, masquerade enabled, target REJECT, exposed services
- **home**: localBridge, target ACCEPT, 26 services, no masquerade
- **internal**: enp15s0 + internalBridge + vnet17 + enp14s0, 11 services
- **public**: publicBridge, masquerade enabled, target REJECT

### Common Patterns Across Features

**Input entity initialization:**
- Always publish empty string `''` states for text inputs to avoid "unknown" in Home Assistant
- Publish states AFTER publishing discovery entities
- Use `mode: 'text'` for password fields when editability is required

**MQTT message handling:**
- Store pending changes in memory until "Apply" button is pressed
- Echo back state changes immediately for UI responsiveness
- Use atomic file operations: backup → temp → move → reload service

**Error handling:**
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

**Files the features read and write:**

| Feature | Path |
|---|---|
| `HostapdManager` | `/etc/hostapd/2.4Ghz.conf`, `/etc/hostapd/5Ghz.conf` |
| `PppoeCredentials` | `/etc/NetworkManager/system-connections/pppoe-enp6s0.835.nmconnection` (mode 600, needs sudo) |
| `FirewallManager` | `firewall-cmd` (firewalld, **nftables** backend) |
| `VmManager` | `virsh` on domain `Windows` |

**firewalld uses the nftables backend** — `iptables -t nat -S` looks empty but isn't; check
`nft list table inet firewalld`. A `firewall-cmd --reload` rebuilds only
`table inet firewalld` and never foreign tables (`f2b-table`, `crowdsec`,
`inet nivuus_smb`), which is why the FirewallManager's reloads are safe.

**`ppp0` is dynamic** and is placed in the `external` zone by
`/etc/ppp/ip-up.d/firewalld-external` on every link-up.

**`virsh` output is localized** — scripts must use `LC_ALL=C`. And **plain `virsh shutdown`
does not deliver the ACPI event** on libvirt 11.x without a guest agent: `VmManager.ts`
stop/restart pass `--mode acpi`, which is the only reliable path (`virsh destroy` is the
forceful fallback).

**RF coexistence (do not break):** hostapd 2.4 GHz is **pinned to channel 6** with `[HT40+]`
deliberately removed, because Zigbee sits on ch 25 (2475 MHz) and Thread on ch 21
(2455 MHz). ACS or a 40 MHz secondary channel would cover them. 5 GHz is ch 36, VHT80.
Note `systemctl reload hostapd` **cannot** apply channel or BSS changes — those need a
`restart` (~10 s outage, clients re-attach automatically).

**Deployment target**: the agent runs on the Nivuus host as `mqtt-system-agent.service`,
with device ID `nivuus` in Home Assistant.
