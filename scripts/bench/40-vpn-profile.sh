#!/usr/bin/env bash
# Runs INSIDE the bench VM. Imports the ZoogVPN profile as nivuus-guest-vpn and
# applies the plan's settings (task 1 step 3). Credentials are written by
# set-vpn-secrets.py, which reads /root/vpn/auth.txt itself.
# Usage: 40-vpn-profile.sh [ovpn-file]
set -euo pipefail
export LC_ALL=C
OVPN="${1:-/root/vpn/alkmaar.ovpn}"
NAME=nivuus-guest-vpn

nmcli -t -f NAME connection show | grep -qx "$NAME" && nmcli connection delete "$NAME" >/dev/null
# nmcli names the imported profile after the file's basename.
imported="$(basename "$OVPN" .ovpn)"
nmcli connection import type openvpn file "$OVPN" >/dev/null
nmcli connection modify "$imported" connection.id "$NAME"

nmcli connection modify "$NAME" \
  +vpn.data dev=nvguest0 +vpn.data dev-type=tun \
  connection.zone external \
  connection.autoconnect no \
  ipv4.route-table 200 ipv6.route-table 200 \
  ipv4.never-default no \
  ipv4.routing-rules "priority 99 iif publicBridge table main suppress_prefixlength 0, priority 100 iif publicBridge table 200, priority 101 oif nvguest0 table 200" \
  ipv6.routing-rules "priority 100 iif publicBridge table 200" \
  ipv6.routes "::/0 table=200 type=unreachable"

python3 -I /root/set-vpn-secrets.py "$NAME" /root/vpn/auth.txt

# Show what NM stored, without the username or the password.
nmcli -g vpn.data connection show "$NAME" | tr ',' '\n' | sed 's/^ *//' \
  | grep -v '^username' | sed 's/^/  vpn.data: /'
nmcli -f connection.zone,connection.autoconnect,ipv4.route-table,ipv6.route-table,ipv4.never-default,ipv4.routing-rules,ipv6.routing-rules,ipv6.routes \
  connection show "$NAME" | sed 's/^/  /'
# The keyfile keeps the imported file name (alkmaar.nmconnection), not the id.
f="$(nmcli -t -f NAME,FILENAME connection show | awk -F: -v n="$NAME" '$1 == n {print $2}')"
ls -la "$f" | sed 's/^/  keyfile: /'
echo "  keyfile sections: $(grep -o '^\[[a-z0-9-]*\]' "$f" | tr '\n' ' ')"
echo "  [vpn-secrets] has password: $(sed -n '/^\[vpn-secrets\]/,/^\[/p' "$f" | grep -c '^password=')"
