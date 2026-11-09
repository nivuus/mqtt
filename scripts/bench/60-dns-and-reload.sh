#!/usr/bin/env bash
# Runs INSIDE the bench VM with the tunnel up. Task 1 step 6:
#  1. guest DNS leak test (a unique name queried by the guest must never be
#     seen on the uplink in clear; it must leave through nvguest0),
#  2. guest IPv6 DNS rejected,
#  3. `firewall-cmd --reload` then `systemctl restart firewalld` (bench only):
#     the nivuus_guest_vpn table and nvguest0's zone must survive and the
#     localBridge stand-in must keep internet (see /root/exit-ip.log).
# firewalld runs with --debug=1 from the restart on, so the journal shows the
# zone binding NM requests for nvguest0.
set -uo pipefail
export LC_ALL=C

leak_test() { # label
  local name
  name="leak-$(date +%s%N).example.com"
  tcpdump -i enp0s2 -nn -l -A udp port 53 or tcp port 53 2>/dev/null > /tmp/uplink53.txt &
  local p1=$!
  tcpdump -i nvguest0 -nn -l udp port 53 or tcp port 53 2>/dev/null > /tmp/tunnel53.txt &
  local p2=$!
  sleep 1
  ip netns exec guest dig +time=3 +tries=1 "$name" >/dev/null           # router resolver
  ip netns exec guest dig +time=3 +tries=1 "$name" @8.8.8.8 >/dev/null  # hardcoded resolver
  ip netns exec guest dig +tcp +time=3 +tries=1 "$name" @1.1.1.1 >/dev/null
  sleep 1
  kill "$p1" "$p2" 2>/dev/null; wait "$p1" "$p2" 2>/dev/null
  printf '  %-26s name on uplink in clear: %s, DNS packets on nvguest0: %s\n' "$1" \
    "$(grep -c "$name" /tmp/uplink53.txt)" "$(grep -c . /tmp/tunnel53.txt)"
  printf '  %-26s resolver seen by akamai: guest=%s home=%s\n' "" \
    "$(ip netns exec guest dig +short +time=3 +tries=1 whoami.akamai.net @8.8.8.8 | tail -1)" \
    "$(ip netns exec homedev dig +short +time=3 +tries=1 whoami.akamai.net | tail -1)"
}
v6_test() {
  printf '  %-26s guest v6 DNS to router: %s; to 2001:4860:4860::8888: %s\n' "$1" \
    "$(ip netns exec guest dig -6 +time=2 +tries=1 example.com @fd00:0:0:20::1 2>&1 | grep -oE 'status: [A-Z]+|refused|timed out|unreachable' | head -1)" \
    "$(ip netns exec guest dig -6 +time=2 +tries=1 example.com @2001:4860:4860::8888 2>&1 | grep -oE 'status: [A-Z]+|refused|timed out|unreachable' | head -1)"
}
state() {
  printf '  %-26s table=%s nvguest0-zone=%s localBridge-zone=%s firewalld=%s\n' "$1" \
    "$(nft list tables | grep -c 'inet nivuus_guest_vpn')" \
    "$(firewall-cmd --get-zone-of-interface=nvguest0 2>&1)" \
    "$(firewall-cmd --get-zone-of-interface=localBridge 2>&1)" "$(firewall-cmd --state 2>&1)"
}

echo "== tunnel up"
state "before"
leak_test "before"
v6_test "before"

echo "== firewall-cmd --reload"
t="$(date '+%F %T')"
firewall-cmd --reload
sleep 2
state "after reload"
leak_test "after reload"
journalctl -u firewalld --since "$t" --no-pager -o cat | grep -v 'ip6\?tables' | sed 's/^/  fw: /'

echo "== systemctl restart firewalld (debug=1)"
echo 'FIREWALLD_ARGS=--debug=1' > /etc/default/firewalld
t="$(date '+%F %T')"
systemctl restart firewalld
sleep 4
state "after restart"
leak_test "after restart"
v6_test "after restart"
echo "  firewalld journal, nvguest0 binding:"
journalctl -u firewalld --since "$t" --no-pager -o short-precise | grep -E 'nvguest0' \
  | cut -c1-200 | sed 's/^/    /'
rm -f /etc/default/firewalld
