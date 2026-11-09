#!/usr/bin/env bash
# Runs INSIDE the bench VM (systemd-run --unit=block-test ...). Task 1 step 5:
# blocks the OpenVPN endpoint for BLOCK_S seconds with a bench-only nft table,
# then unblocks and watches for WATCH_S seconds whether NM brings the tunnel
# back on its own. Log: /root/block-test.log
#   MODE=out:    drop UDP to port 1194 on output (openvpn gets EPERM at once)
#   MODE=silent: drop UDP from port 1194 on input (a real outage: silent loss)
# Usage: 50-block-endpoint.sh BLOCK_S WATCH_S MODE
set -uo pipefail
export LC_ALL=C
BLOCK_S="${1:-120}"
WATCH_S="${2:-300}"
MODE="${3:-silent}"
LOG=/root/block-test.log
: > "$LOG"

state() {
  local vpn pub
  vpn="$(nmcli -t -f NAME,STATE con show --active | awk -F: '$1=="nivuus-guest-vpn"{print $2}')"
  pub="$(nmcli -t -f NAME,STATE con show --active | awk -F: '$1=="bridge-publicBridge"{print $2}')"
  printf '%s t=%4ss vpn=%-12s publicBridge=%-10s nvguest0=%s guest-exit=%s\n' \
    "$(date +%T)" "$1" "${vpn:-none}" "${pub:-none}" \
    "$(ip link show nvguest0 >/dev/null 2>&1 && echo up || echo absent)" \
    "$(tail -1 /root/exit-ip.log | sed 's/.*guest=//')" >> "$LOG"
}

t0=$(date +%s)
state 0
nft add table inet bench_block
if [ "$MODE" = out ]; then
  nft add chain inet bench_block c '{ type filter hook output priority -10; }'
  nft add rule inet bench_block c udp dport 1194 drop
else
  nft add chain inet bench_block c '{ type filter hook input priority -10; }'
  nft add rule inet bench_block c udp sport 1194 drop
fi
echo "$(date +%T) endpoint blocked ($MODE)" >> "$LOG"
while [ $(( $(date +%s) - t0 )) -lt "$BLOCK_S" ]; do sleep 5; state $(( $(date +%s) - t0 )); done
nft delete table inet bench_block
echo "$(date +%T) endpoint unblocked" >> "$LOG"
while [ $(( $(date +%s) - t0 )) -lt $(( BLOCK_S + WATCH_S )) ]; do sleep 5; state $(( $(date +%s) - t0 )); done
echo "$(date +%T) done" >> "$LOG"
