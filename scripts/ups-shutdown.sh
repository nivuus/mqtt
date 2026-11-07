#!/bin/bash
# Graceful shutdown script for UPS critical battery event
# Called by: mqtt-system-agent UpsMonitor + NUT upsmon SHUTDOWNCMD
# Total budget: ~90s (well within 2 min UPS runtime at critical)

set -euo pipefail

LOG_TAG="ups-shutdown"

log() {
  logger -t "$LOG_TAG" "$1"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "=== UPS GRACEFUL SHUTDOWN INITIATED ==="

# Phase 1: Shutdown every running VM (up to 60s); the domain name is not
# hardcoded because it differs between installs.
log "Phase 1: Shutting down running VMs..."
mapfile -t running_vms < <(virsh -c qemu:///system list --name --state-running)
for vm in "${running_vms[@]}"; do
  [ -n "$vm" ] || continue
  # Plain `virsh shutdown` is a silent no-op without a guest agent on libvirt 11.
  virsh -c qemu:///system shutdown --mode acpi "$vm"
  log "Sent ACPI shutdown to $vm"
done
for _ in $(seq 1 60); do
  [ -z "$(virsh -c qemu:///system list --name --state-running | tr -d '[:space:]')" ] && break
  sleep 1
done
# Force destroy whatever is still running
while read -r vm; do
  [ -n "$vm" ] || continue
  log "$vm still running after 60s, force destroying..."
  virsh -c qemu:///system destroy "$vm" 2>/dev/null || true
done < <(virsh -c qemu:///system list --name --state-running)

# Phase 2: Stop Docker containers (15s timeout)
log "Phase 2: Stopping Docker containers..."
mapfile -t running_containers < <(docker ps -q)
if [ "${#running_containers[@]}" -gt 0 ]; then
  docker stop --time 15 "${running_containers[@]}" 2>/dev/null || true
fi
log "Docker containers stopped"

# Phase 3: System shutdown
log "Phase 3: Initiating system shutdown..."
shutdown -h now
