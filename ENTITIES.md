# Home Assistant Entities - MQTT System Agent

This document lists all entities created by the mqtt-system-agent in Home Assistant.

**Device Information:**
- Device ID: `nivuus`
- Device Name: `Nivuus`
- Device Model: `System Agent v1.0`
- MQTT Base Topic: `system_agent/nivuus/`
- HA Discovery Prefix: `homeassistant/`

---

## WiFi/Hostapd Management

**Feature:** `hostapd_manager`

### Summary Sensors
| Entity ID | Type | Description | Update Interval |
|-----------|------|-------------|-----------------|
| `sensor.nivuus_network_wifi_ssids_sensor` | Sensor | Count of configured WiFi networks | On change |

**Attributes:**
- `list`: Array of all SSID names

### Per-Network Entities

For each WiFi network (e.g., network_1, network_2):

| Entity ID Pattern | Type | Description | Mode |
|-------------------|------|-------------|------|
| `text.nivuus_network_wifi_network_N_ssid_input` | Text | SSID name input | text |
| `text.nivuus_network_wifi_network_N_password_input` | Text | WiFi password input | text |
| `select.nivuus_network_wifi_network_N_security_select` | Select | Security type selector | - |
| `button.nivuus_network_wifi_network_N_apply_button` | Button | Apply changes to network | - |
| `button.nivuus_network_wifi_network_N_delete_button` | Button | Delete network | - |
| `sensor.nivuus_network_wifi_network_N_status_sensor` | Sensor | Network status (Active 2.4+5GHz) | On change |

**Security Type Options:**
- WPA2-PSK
- WPA3-SAE
- WPA2/WPA3-Mixed
- Open

### New Network Creation

| Entity ID | Type | Description | Mode |
|-----------|------|-------------|------|
| `text.nivuus_network_wifi_new_ssid_input` | Text | New network SSID | text |
| `text.nivuus_network_wifi_new_password_input` | Text | New network password | password |
| `select.nivuus_network_wifi_new_security_type` | Select | New network security type | - |
| `button.nivuus_network_wifi_add_hotspot_button` | Button | Create new hotspot | - |
| `button.nivuus_network_wifi_reload_hostapd_button` | Button | Reload hostapd service | - |

### Status Sensors

| Entity ID | Type | Description |
|-----------|------|-------------|
| `sensor.nivuus_network_wifi_last_action_sensor` | Sensor | Result of last action |

---

## PPPoE Credentials Management

**Feature:** `pppoe_credentials`

### Configuration Entities

| Entity ID | Type | Description | Mode |
|-----------|------|-------------|------|
| `text.nivuus_network_pppoe_username_input` | Text | PPPoE username | text |
| `text.nivuus_network_pppoe_password_input` | Text | PPPoE password | text |
| `button.nivuus_network_save_pppoe_credentials_button` | Button | Save and apply credentials | - |
| `button.nivuus_network_test_pppoe_connection_button` | Button | Test PPPoE connection | - |

### Status Sensors

| Entity ID | Type | Description |
|-----------|------|-------------|
| `binary_sensor.nivuus_network_pppoe_config_status_sensor` | Binary Sensor | Config detected (ON) or not (OFF) |
| `sensor.nivuus_network_pppoe_connection_sensor` | Sensor | Connection status (CONNECTED/DISCONNECTED/ERROR) |
| `sensor.nivuus_network_pppoe_credentials_count_sensor` | Sensor | Count of credential entries |
| `sensor.nivuus_network_pppoe_last_action_sensor` | Sensor | Result of last action |

**Connection Sensor Attributes:**
- `interface`: ppp0
- `ip`: Local IP address
- `gateway`: Remote gateway IP
- `uptime`: Connection uptime

---

## Firewall Management

**Feature:** `firewalld_manager`

### Interface Zone Management

For each network interface (enp6s0.835, ppp0, enp15s0, enp14s0, localBridge, internalBridge, publicBridge):

| Entity ID Pattern | Type | Description |
|-------------------|------|-------------|
| `sensor.nivuus_network_firewall_IFACE_zone_sensor` | Sensor | Current zone of interface (diagnostic) |
| `select.nivuus_network_firewall_IFACE_zone_select` | Select | Change interface zone (config) |

**Available Zones:**
- block, dmz, docker, drop, external, home, internal, libvirt, libvirt-routed, nm-shared, public, trusted, work

### Port/Service Management

| Entity ID | Type | Description | Mode/Options |
|-----------|------|-------------|--------------|
| `text.nivuus_network_firewall_port_input` | Text | Port number to add/remove | text (pattern: 1-5 digits) |
| `select.nivuus_network_firewall_protocol_select` | Select | Protocol selector | tcp, udp |
| `select.nivuus_network_firewall_zone_select` | Select | Target zone selector | All zones |
| `text.nivuus_network_firewall_service_input` | Text | Service name to add/remove | text |
| `button.nivuus_network_firewall_add_port_button` | Button | Add port to zone | - |
| `button.nivuus_network_firewall_remove_port_button` | Button | Remove port from zone | - |
| `button.nivuus_network_firewall_add_service_button` | Button | Add service to zone | - |
| `button.nivuus_network_firewall_remove_service_button` | Button | Remove service from zone | - |

### Port Forward Management

| Entity ID | Type | Description | Mode/Options |
|-----------|------|-------------|--------------|
| `text.nivuus_network_firewall_forward_port_input` | Text | Source port | text (pattern: 1-5 digits) |
| `text.nivuus_network_firewall_forward_to_address_input` | Text | Destination IP address | text |
| `text.nivuus_network_firewall_forward_to_port_input` | Text | Destination port | text (pattern: 1-5 digits) |
| `select.nivuus_network_firewall_forward_protocol_select` | Select | Forward protocol | tcp, udp |
| `select.nivuus_network_firewall_forward_zone_select` | Select | Forward zone | All zones |
| `button.nivuus_network_firewall_add_forward_button` | Button | Add port forward | - |
| `button.nivuus_network_firewall_remove_forward_button` | Button | Remove port forward | - |

### Zone Detail Sensors

For each active zone (docker, external, home, internal, public):

| Entity ID Pattern | Type | Description | Update Interval |
|-------------------|------|-------------|-----------------|
| `sensor.nivuus_network_firewall_ZONE_port_forwards_sensor` | Sensor | Count of port forwards | 5 minutes |
| `sensor.nivuus_network_firewall_ZONE_services_sensor` | Sensor | Count of services | 5 minutes |
| `sensor.nivuus_network_firewall_ZONE_ports_sensor` | Sensor | Count of open ports | 5 minutes |
| `binary_sensor.nivuus_network_firewall_ZONE_masquerade_sensor` | Binary Sensor | Masquerading enabled (ON/OFF) | 5 minutes |

**Port Forwards Sensor Attributes:**
```json
{
  "forwards": [
    {"port": "3389", "proto": "tcp", "toport": "3389", "toaddr": "192.168.3.2"},
    {"port": "47984", "proto": "tcp", "toport": "47984", "toaddr": "192.168.3.2"}
  ]
}
```

**Services Sensor Attributes:**
```json
{
  "services": ["ssh", "http", "https", "dhcpv6-client", "samba", "mdns"]
}
```

**Ports Sensor Attributes:**
```json
{
  "ports": ["8080/tcp", "9090/udp"]
}
```

### Summary Sensors

| Entity ID | Type | Description |
|-----------|------|-------------|
| `sensor.nivuus_network_firewall_active_zones_sensor` | Sensor | Count of active zones |
| `sensor.nivuus_network_firewall_last_action_sensor` | Sensor | Result of last action |

**Active Zones Sensor Attributes:**
```json
{
  "docker": ["br-000fcd7ebdd2", "hassio", "br-3e78f06c69fe", "br-adc2063fd2f3", "docker0"],
  "external": ["enp6s0.835", "ppp0"],
  "home": ["localBridge"],
  "internal": ["enp15s0", "internalBridge", "vnet17", "enp14s0"],
  "public": ["publicBridge"]
}
```

---

## CPU Monitoring

**Feature:** `cpu_temperature`, `cpu_load`

### Temperature Sensors

| Entity ID Pattern | Type | Description | Update Interval |
|-------------------|------|-------------|-----------------|
| `sensor.nivuus_cpu_core_N_temperature_sensor` | Sensor | Per-core temperature (°C) | 30 seconds |
| `sensor.nivuus_cpu_package_temperature_sensor` | Sensor | Package temperature (°C) | 30 seconds |

**Device Class:** temperature
**Unit:** °C
**Cores:** 0-23 (Intel i9-12900K: 8 P-cores + 8 E-cores with HT)

### Load Sensors

| Entity ID | Type | Description | Update Interval |
|-----------|------|-------------|-----------------|
| `sensor.nivuus_cpu_load_1min_sensor` | Sensor | 1-minute load average | 60 seconds |
| `sensor.nivuus_cpu_load_5min_sensor` | Sensor | 5-minute load average | 60 seconds |
| `sensor.nivuus_cpu_load_15min_sensor` | Sensor | 15-minute load average | 60 seconds |
| `sensor.nivuus_cpu_usage_percent_sensor` | Sensor | CPU usage percentage | 60 seconds |

---

## Memory Monitoring

**Feature:** `memory_usage`

| Entity ID | Type | Description | Update Interval |
|-----------|------|-------------|-----------------|
| `sensor.nivuus_memory_total_sensor` | Sensor | Total RAM (GB) | 5 minutes |
| `sensor.nivuus_memory_used_sensor` | Sensor | Used RAM (GB) | 60 seconds |
| `sensor.nivuus_memory_available_sensor` | Sensor | Available RAM (GB) | 60 seconds |
| `sensor.nivuus_memory_usage_percent_sensor` | Sensor | Memory usage (%) | 60 seconds |
| `sensor.nivuus_swap_total_sensor` | Sensor | Total swap (GB) | 5 minutes |
| `sensor.nivuus_swap_used_sensor` | Sensor | Used swap (GB) | 60 seconds |

---

## Disk Monitoring

**Feature:** `disk_usage`

### Per-Disk Sensors

For each disk (/, /boot, /home, etc.):

| Entity ID Pattern | Type | Description | Update Interval |
|-------------------|------|-------------|-----------------|
| `sensor.nivuus_disk_MOUNT_total_sensor` | Sensor | Total disk size (GB) | 5 minutes |
| `sensor.nivuus_disk_MOUNT_used_sensor` | Sensor | Used disk space (GB) | 5 minutes |
| `sensor.nivuus_disk_MOUNT_available_sensor` | Sensor | Available space (GB) | 5 minutes |
| `sensor.nivuus_disk_MOUNT_usage_percent_sensor` | Sensor | Usage percentage | 5 minutes |

---

## Network Monitoring

**Feature:** `network_interfaces`

### Per-Interface Sensors

For each interface (enp6s0, ppp0, localBridge, etc.):

| Entity ID Pattern | Type | Description | Update Interval |
|-------------------|------|-------------|-----------------|
| `sensor.nivuus_network_IFACE_device_count_sensor` | Sensor | Connected devices count | 5 minutes |
| `sensor.nivuus_network_IFACE_rx_bytes_sensor` | Sensor | Received bytes | 60 seconds |
| `sensor.nivuus_network_IFACE_tx_bytes_sensor` | Sensor | Transmitted bytes | 60 seconds |
| `sensor.nivuus_network_IFACE_rx_packets_sensor` | Sensor | Received packets | 60 seconds |
| `sensor.nivuus_network_IFACE_tx_packets_sensor` | Sensor | Transmitted packets | 60 seconds |
| `sensor.nivuus_network_IFACE_speed_sensor` | Sensor | Interface speed (Mbps) | On change |
| `binary_sensor.nivuus_network_IFACE_status_sensor` | Binary Sensor | Interface up (ON) or down (OFF) | 60 seconds |

**Device Count Attributes:**
```json
{
  "devices": [
    {"mac": "00:11:22:33:44:55", "ip": "192.168.1.100", "vendor": "Apple Inc."},
    {"mac": "66:77:88:99:aa:bb", "ip": "192.168.1.101", "vendor": "Samsung Electronics"}
  ]
}
```

---

## VM Management

**Feature:** `vm_control`

### Per-VM Entities

For each VM (e.g., "gaming-vm"):

| Entity ID Pattern | Type | Description |
|-------------------|------|-------------|
| `switch.nivuus_vm_NAME_power_switch` | Switch | Power control (ON=running, OFF=stopped) |
| `button.nivuus_vm_NAME_restart_button` | Button | Restart VM |
| `sensor.nivuus_vm_NAME_status_sensor` | Sensor | VM status (running/stopped/paused) |
| `sensor.nivuus_vm_NAME_cpu_usage_sensor` | Sensor | VM CPU usage (%) |
| `sensor.nivuus_vm_NAME_memory_usage_sensor` | Sensor | VM memory usage (MB) |

---

## System Services

**Feature:** `systemd_services`

### Per-Service Entities

For monitored services (firewalld, docker, ssh, etc.):

| Entity ID Pattern | Type | Description |
|-------------------|------|-------------|
| `binary_sensor.nivuus_system_service_NAME_status_sensor` | Binary Sensor | Service running (ON) or stopped (OFF) |
| `button.nivuus_system_service_NAME_restart_button` | Button | Restart service |
| `button.nivuus_system_service_NAME_start_button` | Button | Start service |
| `button.nivuus_system_service_NAME_stop_button` | Button | Stop service |

---

## System Updates

**Feature:** `system_updates`

| Entity ID | Type | Description | Update Interval |
|-----------|------|-------------|-----------------|
| `sensor.nivuus_system_updates_available_sensor` | Sensor | Count of available updates | 6 hours |
| `sensor.nivuus_system_security_updates_sensor` | Sensor | Count of security updates | 6 hours |
| `button.nivuus_system_check_updates_button` | Button | Check for updates now | - |
| `button.nivuus_system_install_updates_button` | Button | Install all updates | - |

**Updates Sensor Attributes:**
```json
{
  "packages": [
    {"name": "linux-image-amd64", "current": "6.1.0-40", "available": "6.1.0-41"},
    {"name": "systemd", "current": "252.1-1", "available": "252.2-1"}
  ]
}
```

---

## SMART Disk Monitoring

**Feature:** `smart_monitoring`

### Per-Disk SMART Sensors

For each physical disk (sda, nvme0n1, etc.):

| Entity ID Pattern | Type | Description | Update Interval |
|-------------------|------|-------------|-----------------|
| `binary_sensor.nivuus_disk_DEVICE_health_sensor` | Binary Sensor | SMART health (ON=healthy, OFF=failing) | 1 hour |
| `sensor.nivuus_disk_DEVICE_temperature_sensor` | Sensor | Disk temperature (°C) | 5 minutes |
| `sensor.nivuus_disk_DEVICE_power_on_hours_sensor` | Sensor | Total power-on hours | 1 hour |
| `sensor.nivuus_disk_DEVICE_reallocated_sectors_sensor` | Sensor | Reallocated sector count | 1 hour |

---

## Motherboard Sensors

**Feature:** `motherboard_sensors`

| Entity ID | Type | Description | Update Interval |
|-----------|------|-------------|-----------------|
| `sensor.nivuus_motherboard_fan_N_speed_sensor` | Sensor | Fan speed (RPM) | 30 seconds |
| `sensor.nivuus_motherboard_voltage_N_sensor` | Sensor | Voltage rail (V) | 30 seconds |
| `sensor.nivuus_motherboard_temperature_sensor` | Sensor | Motherboard temp (°C) | 30 seconds |

---

## Global Sensors

**Feature:** `agent` (inline in Agent.ts)

| Entity ID | Type | Description |
|-----------|------|-------------|
| `sensor.nivuus_agent_alert_sensor` | Sensor | System alerts |
| `sensor.nivuus_agent_event_sensor` | Sensor | System events |

---

## Entity Naming Conventions

### Pattern Format
```
{component}.nivuus_{category}_{specific_name}_{type}
```

### Examples
- `sensor.nivuus_cpu_core_0_temperature_sensor`
- `switch.nivuus_vm_gaming_vm_power_switch`
- `button.nivuus_network_firewall_add_port_button`
- `select.nivuus_network_firewall_enp6s0_835_zone_select`

### Categories
- `cpu` - CPU monitoring
- `memory` - RAM/swap monitoring
- `disk` - Disk usage and SMART
- `network` - Network interfaces and firewall
- `vm` - Virtual machine control
- `system` - System services and updates
- `motherboard` - Hardware sensors
- `agent` - Global alerts/events

### Type Suffixes
- `_sensor` - Sensor entities
- `_switch` - Switch entities
- `_button` - Button entities
- `_input` - Text input entities
- `_select` - Select/dropdown entities

---

## Total Entity Count

**Approximate totals** (varies based on system configuration):

| Category | Sensor | Binary Sensor | Text | Select | Button | Switch | Total |
|----------|--------|---------------|------|--------|--------|--------|-------|
| WiFi/Hostapd | 13 | 0 | 8 | 4 | 6 | 0 | **31** |
| PPPoE | 3 | 1 | 2 | 0 | 2 | 0 | **8** |
| Firewall | 30 | 5 | 5 | 10 | 6 | 0 | **56** |
| CPU | 26 | 0 | 0 | 0 | 0 | 0 | **26** |
| Memory | 6 | 0 | 0 | 0 | 0 | 0 | **6** |
| Disk | 16 | 4 | 0 | 0 | 0 | 0 | **20** |
| Network | 42 | 7 | 0 | 0 | 0 | 0 | **49** |
| VM | 3 | 0 | 0 | 0 | 1 | 1 | **5** |
| System Services | 0 | 10 | 0 | 0 | 30 | 0 | **40** |
| System Updates | 2 | 0 | 0 | 0 | 2 | 0 | **4** |
| SMART | 4 | 4 | 0 | 0 | 0 | 0 | **8** |
| Motherboard | 8 | 0 | 0 | 0 | 0 | 0 | **8** |
| **TOTAL** | **153** | **31** | **15** | **14** | **47** | **1** | **~261** |

---

## Configuration Files

### MQTT Agent Config
**Path:** `/home/mallanic/Projects/Nivuus/mqtt/config/agent.yaml`

### System Config Paths
- **WiFi:** `/etc/hostapd/2.4Ghz.conf`, `/etc/hostapd/5Ghz.conf`
- **PPPoE:** `/etc/NetworkManager/system-connections/pppoe-enp6s0.835.nmconnection`
- **Firewall:** `/etc/firewalld/` (managed via firewall-cmd)

### Service Management
**Systemd Service:** `mqtt-system-agent.service`

```bash
# View logs
sudo journalctl -u mqtt-system-agent.service -f

# Restart service
sudo systemctl restart mqtt-system-agent.service

# Check status
sudo systemctl status mqtt-system-agent.service
```

---

**Last Updated:** 2025-11-08
**Agent Version:** 1.0.0
**Home Assistant Compatibility:** 2023.x+
