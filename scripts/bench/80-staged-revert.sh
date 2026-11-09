#!/usr/bin/env bash
# Runs INSIDE the bench VM through `vm.sh qga` (the failing reload locks SSH out).
# Task 9b step 4: reproduce the 12:09 failure once more and time the staged revert:
#   1. back up /etc/firewalld/zones (the healthy state);
#   2. put the host's internal.xml back (stale <interface name="enp15s0"/>, which contradicts
#      NM's connection.zone=home for the localBridge port) and `firewall-cmd --reload`;
#   3. `nft delete table inet firewalld_policy_drop`: traffic must return at once;
#   4. restore the zone backup + `systemctl restart firewalld`: clean state, every binding as
#      on the host, home and guest stand-ins online.
# Log: /root/t9b/step4.log (also printed).
set -uo pipefail
export LC_ALL=C
LOG=/root/t9b/step4.log
exec > >(tee "$LOG") 2>&1

probe() { ip netns exec "$1" curl -s -m 4 -o /dev/null -w '%{http_code}' http://connectivitycheck.gstatic.com/generate_204 || true; }
ts() { date +%T.%N | cut -c1-12; }
check() {
  printf '%s %-34s state=%-11s drop-table=%s home=%s guest=%s\n' "$(ts)" "$1" \
    "$(firewall-cmd --state 2>&1)" "$(nft list tables | grep -c firewalld_policy_drop)" \
    "$(probe homedev)" "$(probe guest)"
}
bindings() {
  local want="enp15s0=home localBridge=home internalBridge=internal vnet17=internal
              publicBridge=public enp5s0=drop enp5s0.835=drop wpan0=trusted enp0s2=external"
  local pair got bad=0
  for pair in $want; do
    got="$(firewall-cmd --get-zone-of-interface="${pair%%=*}" 2>&1)"
    [ "$got" = "${pair#*=}" ] || { echo "  binding mismatch ${pair%%=*}: $got"; bad=1; }
  done
  [ "$bad" = 0 ] && echo "  bindings as on the host: ok"
}

BK=/root/t9b/zones-backup
rm -rf "$BK"; cp -a /etc/firewalld/zones "$BK"
echo "backup: $(ls "$BK" | tr '\n' ' ')"
echo "internal.xml lists enp15s0 (healthy): $(grep -c 'interface name="enp15s0"' /etc/firewalld/zones/internal.xml)"
check "healthy start"
bindings

cp /root/host-firewalld/zones/internal.xml /etc/firewalld/zones/internal.xml
echo "internal.xml lists enp15s0 (host copy): $(grep -c 'interface name="enp15s0"' /etc/firewalld/zones/internal.xml)"
since="$(date '+%F %T')"
t0=$(date +%s.%N)
firewall-cmd --reload >/dev/null 2>&1; rc=$?
check "after firewall-cmd --reload (rc=$rc)"
journalctl -u firewalld --since "$since" --no-pager -o cat | grep ERROR | grep -v 'ip6\?tables' | cut -c1-140 | sort | uniq -c

t1=$(date +%s.%N)
nft delete table inet firewalld_policy_drop; drc=$?
t2=$(date +%s.%N)
check "after nft delete (rc=$drc)"
printf 'stage 1: nft delete took %.3f s; outage from reload to delete %.1f s\n' \
  "$(echo "$t2 - $t1" | bc -l)" "$(echo "$t2 - $t0" | bc -l)"

rm -rf /etc/firewalld/zones && cp -a "$BK" /etc/firewalld/zones
t3=$(date +%s.%N)
systemctl restart firewalld; src=$?
t4=$(date +%s.%N)
sleep 2
check "after restore + restart (rc=$src)"
printf 'stage 2: restart took %.1f s\n' "$(echo "$t4 - $t3" | bc -l)"
bindings
echo "internal.xml lists enp15s0 (restored): $(grep -c 'interface name="enp15s0"' /etc/firewalld/zones/internal.xml)"
echo "nvguest0 zone: $(firewall-cmd --get-zone-of-interface=nvguest0 2>&1)"
journalctl -u firewalld --since "$(date -d @"${t3%.*}" '+%F %T')" --no-pager -o cat | grep ERROR \
  | grep -v 'ip6\?tables' | cut -c1-140 | sort | uniq -c
