#!/usr/bin/env bash
# Runs INSIDE the bench VM (run it through `vm.sh qga`: when the reload fails
# the bench firewalls itself shut, SSH included).
#
# Reproduces the 2026-11-09 12:09 host incident and verifies the fix.
#   unfixed: internal.xml exactly as on the host (permanent <interface enp15s0>)
#   fixed:   the same file without that line (NM binds enp15s0 to home)
# Each run starts from a healthy firewall with every binding asserted, then
# runs `firewall-cmd --reload` and reports firewalld state, the leftover
# reload DROP table and internet access of the home and guest stand-ins.
set -uo pipefail
export LC_ALL=C
MODE="${1:?unfixed|fixed}"
CONNS=(bridge-internalBridge vnet17 bridge-localBridge bridge-slave-enp15s0
       bridge-publicBridge enp5s0 enp5s0.835)

probe() {
  ip netns exec "$1" curl -s -m 4 -o /dev/null -w '%{http_code}' \
    http://connectivitycheck.gstatic.com/generate_204 || true
}
check() {
  printf '  %-40s state=%-11s drop-table=%s home=%s guest=%s\n' "$1" \
    "$(firewall-cmd --state 2>&1)" "$(nft list tables | grep -c firewalld_policy_drop)" \
    "$(probe homedev)" "$(probe guest)"
}
errors_since() {
  journalctl -u firewalld --since "$1" --no-pager -o cat | grep 'ERROR' \
    | grep -v 'ip6\?tables' | cut -c1-110 | sort | uniq -c | sed 's/^/    /'
}
healthy_start() {
  for c in "${CONNS[@]}"; do nmcli connection down "$c" >/dev/null 2>&1 || true; done
  systemctl restart firewalld
  for c in "${CONNS[@]}"; do
    nmcli connection modify "$c" connection.autoconnect yes
    nmcli connection up "$c" >/dev/null
  done
  systemctl start docker
  bash /root/25-standins.sh
  sleep 2
  local want="enp15s0=home localBridge=home internalBridge=internal vnet17=internal
              publicBridge=public enp5s0=drop enp5s0.835=drop wpan0=trusted enp0s2=external"
  local pair got bad=0
  for pair in $want; do
    got="$(firewall-cmd --get-zone-of-interface="${pair%%=*}" 2>&1)"
    [ "$got" = "${pair#*=}" ] || { echo "  BINDING MISMATCH ${pair%%=*}: $got"; bad=1; }
  done
  [ "$bad" = 0 ] && echo "  bindings as on the host: ok"
}
spike_objects() { # add|remove
  if [ "$1" = add ]; then
    firewall-cmd --permanent --new-zone=guestvpn >/dev/null
    firewall-cmd --permanent --zone=guestvpn --set-target=DROP >/dev/null
    firewall-cmd --permanent --zone=guestvpn --add-masquerade >/dev/null
    firewall-cmd --permanent --new-policy=guest-to-vpn >/dev/null
    firewall-cmd --permanent --policy=guest-to-vpn --add-ingress-zone=public >/dev/null
    firewall-cmd --permanent --policy=guest-to-vpn --add-egress-zone=guestvpn >/dev/null
    firewall-cmd --permanent --policy=guest-to-vpn --set-target=ACCEPT >/dev/null
  else
    firewall-cmd --permanent --delete-policy=guest-to-vpn >/dev/null 2>&1 || true
    firewall-cmd --permanent --delete-zone=guestvpn >/dev/null 2>&1 || true
  fi
}

cp /root/host-firewalld/zones/internal.xml /etc/firewalld/zones/internal.xml
[ "$MODE" = fixed ] && sed -i '/<interface name="enp15s0"\/>/d' /etc/firewalld/zones/internal.xml
echo "== $MODE: internal.xml lists enp15s0: $(grep -c 'interface name="enp15s0"' /etc/firewalld/zones/internal.xml)"
spike_objects remove

echo "-- plain reload"
healthy_start
check "before reload"
since="$(date '+%F %T')"
firewall-cmd --reload >/dev/null 2>&1; check "after firewall-cmd --reload (rc=$?)"
errors_since "$since"

echo "-- spike objects (zone guestvpn, policy guest-to-vpn) + reload"
healthy_start
spike_objects add
since="$(date '+%F %T')"
firewall-cmd --reload >/dev/null 2>&1; check "after firewall-cmd --reload (rc=$?)"
errors_since "$since"
spike_objects remove

if [ "$MODE" = fixed ]; then
  echo "-- fixed: repeated reloads, restart, internal emptied"
  healthy_start
  since="$(date '+%F %T')"
  for i in 1 2 3; do firewall-cmd --reload >/dev/null 2>&1; check "reload #$i (rc=$?)"; done
  systemctl restart firewalld; sleep 3; check "systemctl restart firewalld"
  nmcli connection down vnet17 >/dev/null; nmcli connection down bridge-internalBridge >/dev/null
  echo "  internal interfaces now: [$(firewall-cmd --zone=internal --list-interfaces)]"
  nmcli connection down bridge-slave-enp15s0 >/dev/null
  nmcli connection up bridge-slave-enp15s0 >/dev/null; check "internal empty, enp15s0 flapped"
  firewall-cmd --reload >/dev/null 2>&1; check "internal empty, reload (rc=$?)"
  errors_since "$since"
fi

# Leave the bench usable whatever happened above.
if [ "$(nft list tables | grep -c firewalld_policy_drop)" != 0 ] || ! firewall-cmd --state >/dev/null 2>&1; then
  echo "-- recovering bench: systemctl restart firewalld"
  healthy_start >/dev/null
  check "after recovery"
fi
