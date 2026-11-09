#!/usr/bin/env bash
# Guest VPN bench VM: start / stop / ssh / scp.
# The VM's only NIC is QEMU user-mode networking (slirp): no tap, no bridge,
# no libvirt network, so nothing on the host binds to a firewalld zone.
set -euo pipefail

BENCH_DIR="${BENCH_DIR:-/root/work/guest-vpn-bench}"
SSH_PORT="${SSH_PORT:-2422}"
SSH_OPTS=(-i "$BENCH_DIR/bench_key" -o StrictHostKeyChecking=no
          -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5)

case "${1:-}" in
  start)
    exec qemu-system-x86_64 \
      -name guest-vpn-bench -machine q35,accel=kvm -cpu host -smp 2 -m 2048 \
      -drive file="$BENCH_DIR/bench.qcow2",if=virtio,format=qcow2 \
      -drive file="$BENCH_DIR/seed.iso",if=virtio,format=raw,readonly=on \
      -netdev user,id=n0,hostfwd=tcp:127.0.0.1:"$SSH_PORT"-:22 \
      -device virtio-net-pci,netdev=n0 \
      -chardev socket,path="$BENCH_DIR/qga.sock",server=on,wait=off,id=qga0 \
      -device virtio-serial -device virtserialport,chardev=qga0,name=org.qemu.guest_agent.0 \
      -display none -serial file:"$BENCH_DIR/console.log" \
      -pidfile "$BENCH_DIR/qemu.pid" -daemonize
    ;;
  stop)
    ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" root@127.0.0.1 systemctl poweroff || true
    for _ in $(seq 90); do
      pid="$(cat "$BENCH_DIR/qemu.pid" 2>/dev/null || true)"
      if [ -z "$pid" ] || [ ! -e "/proc/$pid" ]; then exit 0; fi
      sleep 1
    done
    echo "VM did not power off" >&2
    exit 1
    ;;
  ssh)
    shift
    exec ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" root@127.0.0.1 "$@"
    ;;
  scp)
    shift
    exec scp "${SSH_OPTS[@]}" -P "$SSH_PORT" "$@"
    ;;
  qga)
    # Out-of-band shell through the QEMU guest agent, for when the bench's own
    # firewall has locked SSH out. Usage: vm.sh qga 'shell command'
    shift
    exec python3 -I "$(dirname "$0")/qga-exec.py" "$BENCH_DIR/qga.sock" "$*"
    ;;
  *)
    echo "usage: $0 start|stop|ssh [cmd...]|scp src... root@127.0.0.1:dst|qga 'cmd'" >&2
    exit 2
    ;;
esac
