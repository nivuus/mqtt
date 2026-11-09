#!/usr/bin/env bash
# Read-only snapshot of the live host's network state, to prove the bench VM
# changed nothing. Usage: host-snapshot.sh <label>   (writes <label>.* files)
# Compare two labels with: host-snapshot.sh --diff before after
set -euo pipefail

SNAP_DIR="${SNAP_DIR:-/root/work/guest-vpn-bench/host-snap}"
mkdir -p "$SNAP_DIR"
cd "$SNAP_DIR"

if [ "${1:-}" = "--diff" ]; then
  rc=0
  for kind in nft-tables ip-link ip-rule ip6-rule zones; do
    if diff -u "$kind.$2" "$kind.$3"; then echo "same: $kind"; else rc=1; fi
  done
  echo "firewalld journal entries since $(cat "t0.$2"):"
  journalctl -u firewalld --since "$(cat "t0.$2")" --no-pager -o short-iso | grep -v '^-- No entries' || true
  exit "$rc"
fi

label="$1"
date '+%F %T' > "t0.$label"
nft list tables > "nft-tables.$label"
# Docker veth churn changes link lists independently of the bench, so record
# names and kinds only; state flips are not a bench effect.
ip -br link | awk '{print $1}' | sort > "ip-link.$label"
ip rule > "ip-rule.$label"
ip -6 rule > "ip6-rule.$label"
firewall-cmd --get-active-zones > "zones.$label"
printf 'connectivity: %s\n' \
  "$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://connectivitycheck.gstatic.com/generate_204)"
