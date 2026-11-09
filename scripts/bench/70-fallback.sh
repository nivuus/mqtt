#!/usr/bin/env bash
# Runs INSIDE the bench VM with the tunnel up as a secondary of
# bridge-publicBridge. Task 1 step 7:
#  - tunnel down / profile delete / re-import while up: time until the guest
#    stand-in exits through the uplink again (target: within 5 s), and the
#    localBridge stand-in is unaffected (see /root/exit-ip.log);
#  (import of path-taking directives: 71-import-directives.sh)
set -uo pipefail
export LC_ALL=C
UPLINK_IP="$(curl -s -m 5 https://api.ipify.org)"

wait_up() {
  for _ in $(seq 60); do
    [ "$(nmcli -t -f NAME,STATE con show --active | awk -F: '$1=="nivuus-guest-vpn"{print $2}')" = activated ] && return 0
    sleep 1
  done
  return 1
}
vpn_state() {
  nmcli -t -f NAME,STATE con show --active | awk -F: '$1=="nivuus-guest-vpn"{print $2}'
}
bring_up() {
  [ "$(vpn_state)" = activated ] && return 0
  # The device name is fixed: a new openvpn cannot open nvguest0 while the old
  # one still holds it (TUNSETIFF EBUSY), so wait for it to go away first.
  while ip link show nvguest0 >/dev/null 2>&1; do sleep 0.2; done
  nmcli connection up nivuus-guest-vpn ifname publicBridge >/dev/null 2>&1
  wait_up && sleep 3
}
time_to_uplink() { # label, then the action as remaining args
  local label="$1"; shift
  local t0 ip dns
  t0=$(date +%s.%N)
  "$@" >/dev/null 2>&1
  for _ in $(seq 40); do
    ip="$(ip netns exec guest curl -s -m 1 https://api.ipify.org 2>/dev/null)"
    [ "$ip" = "$UPLINK_IP" ] && break
    sleep 0.25
  done
  dns="$(ip netns exec guest dig +short +time=2 +tries=1 example.com | head -1)"
  printf '  %-34s guest on uplink after %.1f s (exit %s), guest DNS answer=%s, DNAT table=%s\n' \
    "$label" "$(echo "$(date +%s.%N) - $t0" | bc)" "$([ "$ip" = "$UPLINK_IP" ] && echo uplink || echo "${ip:-none}")" \
    "${dns:-none}" "$(nft list tables | grep -c nivuus_guest_vpn)"
}

echo "== fallback timings"
bring_up || echo "  tunnel did not come up"
time_to_uplink "nmcli connection down" nmcli connection down nivuus-guest-vpn
bring_up
time_to_uplink "nmcli connection delete (while up)" nmcli connection delete nivuus-guest-vpn
echo "  publicBridge secondaries now: [$(nmcli -g connection.secondaries con show bridge-publicBridge)]"
bash /root/40-vpn-profile.sh >/dev/null
bring_up
time_to_uplink "re-import (delete+import, while up)" bash /root/40-vpn-profile.sh
echo "  publicBridge secondaries now: [$(nmcli -g connection.secondaries con show bridge-publicBridge)]"
echo "  new profile uuid: $(nmcli -g connection.uuid con show nivuus-guest-vpn)"

