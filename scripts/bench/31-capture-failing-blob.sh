#!/usr/bin/env bash
# Runs INSIDE the bench VM. Captures the ruleset right before the first failing
# firewalld transaction and the failing JSON blob, into /root/enoent/.
# Usage: 31-capture-failing-blob.sh <first-conn> <failing-conn>
set -uo pipefail
export LC_ALL=C
FIRST="${1:-bridge-localBridge}"
SECOND="${2:-bridge-slave-enp15s0}"
OUT=/root/enoent
CONNS=(bridge-localBridge bridge-slave-enp15s0 bridge-publicBridge bridge-internalBridge
       vnet17 enp5s0 enp5s0.835)

mkdir -p "$OUT"
for c in "${CONNS[@]}"; do nmcli connection down "$c" >/dev/null 2>&1 || true; done
systemctl stop docker docker.socket
systemctl restart firewalld
sleep 1
[ "$FIRST" != none ] && nmcli connection up "$FIRST" >/dev/null
sleep 1
nft -j list ruleset > "$OUT/before.json"
since="$(date '+%F %T')"
nmcli connection up "$SECOND" >/dev/null
sleep 1
journalctl -u firewalld --since "$since" --no-pager -o cat \
  | grep -m1 '^{"nftables"' > "$OUT/blob.json" || true
if [ -s "$OUT/blob.json" ]; then
  echo "transaction failed; blob saved"
  python3 -I /root/nft-index-check.py "$OUT/before.json" "$OUT/blob.json" | tail -5
else
  echo "no failure"
fi
firewall-cmd --get-active-zones | grep -v '^ ' | tr '\n' ' '; echo
