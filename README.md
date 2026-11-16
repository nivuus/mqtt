# MQTT System Agent

A TypeScript agent that publishes the health of a Linux host to Home Assistant over MQTT
(Home Assistant MQTT Discovery) and exposes a few host controls (virtual machine, firewalld
zones, Wi-Fi access points, PPPoE credentials, guest VPN) as Home Assistant entities. It is
packaged as a Debian package and runs as a systemd service (`mqtt-system-agent.service`, as
root, because it drives `firewall-cmd`, `hostapd`, `virsh`, `nmcli` and similar tools).

All entities belong to one Home Assistant device, identified by `device_info.identifiers`
in the configuration (`nivuus` in the shipped file). The full entity list is in
[ENTITIES.md](ENTITIES.md).

The agent was extracted from `nivuus/installer`, which documents the host it runs on.

## What it does

Each capability is a *feature*, enabled and tuned in the `features:` section of
`config/agent.yaml`. The features known to the agent are those registered in
`src/core/Agent.ts`:

| Area | Features |
|---|---|
| Sensors | `cpu_temperature`, `cpu_load`, `memory_usage`, `network_stats`, `disk_usage`, `motherboard_temperature`, `gpu_monitoring`, `hardware_health`, `smart_status`, `systemd_services`, `connected_devices` |
| Updates | `apt_updates`, `docker_updates` |
| Controls | `firewalld_manager`, `hostapd_manager`, `vm_manager`, `pppoe_credentials`, `guest_vpn` |
| Security and events | `event_monitor` (fail2ban bans, SSH logins, syslog errors, ClamAV detections) |
| Windows guest (WinRM) | `streaming_status`, `windows_disk_usage`, `kvm_split_lock_monitor` |
| UPS | `ups_monitor` (Network UPS Tools) |

A feature listed under `features:` with `enabled: true` is started; a name the agent does not
know is logged as a warning and skipped. Recommended update intervals are discussed in
[docs/UPDATE_INTERVALS.md](docs/UPDATE_INTERVALS.md) (in French).

## Requirements

- Node.js 22 (the packaged binary is built with `pkg` for `node22-linux-x64`) for development.
- An MQTT broker reachable from the host and the Home Assistant MQTT integration pointed at it.
- For the `.deb`: `network-manager-openvpn`, `python3` and `iproute2` (declared as package
  dependencies in `package.json`).

## Build and install

```bash
npm install
npm run build              # tsc -> dist/
npm test                   # jest (agent) + node --test (ha-dashboard)
npm run package:deb        # needs fpm; produces mqtt-system-agent_<version>_amd64.deb
sudo dpkg -i mqtt-system-agent_*.deb
```

The package installs the executable to `/opt/mqtt-system-agent/mqtt-system-agent` (also linked
as `/usr/bin/mqtt-system-agent`), the default configuration to
`/opt/mqtt-system-agent/config/agent.yaml`, the unit `mqtt-system-agent.service`, and
`scripts/ups-shutdown.sh`. `postinst` enables and starts the unit on install and on upgrade.

An upgrade overwrites the packaged `agent.yaml`; keep site-specific secrets out of it (below).

To run from a checkout instead: `npm run build && npm start` (reads `config/agent.yaml` from
the current directory unless `--config <path>` is given).

## Configuration

The agent reads one YAML file: `--config <path>`, otherwise `config/agent.yaml` relative to the
current directory (the unit passes `--config /opt/mqtt-system-agent/config/agent.yaml`).
`config/agent.yaml` is commented and is the reference. Sections:

- `mqtt`: `host`, `port`, `username`, `password`, `base_topic` (default `system_agent`), and
  optional TLS keys (`protocol`, `ca_file`, `cert_file`, `key_file`, `reject_unauthorized`).
- `device_info`: the Home Assistant device (`identifiers`, `name`, `manufacturer`, `model`).
  Do not change `identifiers` on a running installation: Home Assistant would create a second
  device and duplicate every entity.
- `websocket`: the local channel used by the Home Assistant `nivuus_wizard` integration
  (default `127.0.0.1:8766`, token authentication).
- `windows_vm`: WinRM connection used by the Windows-guest features.
- `features`: per-feature `enabled` flag and `update_interval_seconds` (or
  `check_interval_hours`), plus feature-specific keys.
- `logging.level`: `debug`, `info`, `warn` or `error`.

### Secrets

The repository ships placeholders (`CHANGE_ME_*`). Do not put real secrets in the packaged file.

| Setting | How to provide it |
|---|---|
| MQTT user and password | environment variables `MQTT_USERNAME` and `MQTT_PASSWORD`; they override the file (`src/config.ts`). On a host, set them in a systemd drop-in, for example `/etc/systemd/system/mqtt-system-agent.service.d/*.conf`. |
| WebSocket token | `NIVUUS_WS_TOKEN` (at least 32 characters). Without a real token the WebSocket server refuses to start; the rest of the agent keeps running. |
| WinRM credentials | the `windows_vm` section of the file; `WINDOWS_ADMIN_USERNAME`, `WINDOWS_ADMIN_PASSWORD`, `WINDOWS_HOSTNAME` and `WINDOWS_PORT` are only fallbacks for a key left empty there (`src/utils/winrm.ts`), so they have no effect while the shipped placeholder password is set |
| UPS (NUT) credentials | `NUT_USERNAME`, `NUT_PASSWORD` |

The packaged unit does not load any `EnvironmentFile=`; whatever file or drop-in you use must be
wired to the unit by the operator.

The broker is expected to give each client its own account (Mosquitto Dynamic Security); create
an account for the agent that may publish under `system_agent/#` and `homeassistant/#`, and
subscribe to `homeassistant/status`.

## Topics

```
system_agent/<device_id>/status                    availability (online/offline, last will)
system_agent/<device_id>/<feature>/<entity>/state          entity state
system_agent/<device_id>/<feature>/<entity>/attributes     JSON attributes
system_agent/<device_id>/event                     last event sent by the CLI (see docs/CLI.md)
system_agent/<device_id>/alert                     alert sensor topic (see docs/ALERTS.md)
homeassistant/<component>/<device_id>/<unique_id>/config   discovery (retained)
```

When Home Assistant announces itself on `homeassistant/status`, the agent restarts every
feature so that non-retained states are published again.

## Command line

`mqtt-system-agent event ...` publishes an event to the broker; see [docs/CLI.md](docs/CLI.md).
Alerts and events as Home Assistant sensors: [docs/ALERTS.md](docs/ALERTS.md).

## Home Assistant dashboard

[`ha-dashboard/`](ha-dashboard/README.md) contains the "Serveur" dashboard strategy
(`custom:nivuus-server`) built on these entities.

## Development

Conventions for contributors and coding agents are in [CLAUDE.md](CLAUDE.md). Source files stay
under 500 lines. Adding a feature: extend `BaseFeature` (`src/core/BaseFeature.ts`),
implement `publishDiscovery()` and `update()`, register the class in `availableFeatures`
(`src/core/Agent.ts`) and add its section to `config/agent.yaml`.

## Licence

PolyForm Noncommercial 1.0.0, see [LICENSE.md](LICENSE.md).
