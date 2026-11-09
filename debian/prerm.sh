#!/bin/sh
set -e
# Stop and disable the service
systemctl stop mqtt-system-agent.service
systemctl disable mqtt-system-agent.service

# fpm runs this script from before_remove(), on removal only (never on upgrade: the new agent
# takes over the running tunnel) and WITHOUT arguments, so "$1" must not be tested here.
# Take the guest VPN down and delete the agent's guest DNS table, so guests return to the
# uplink and the router's resolver. Both are guarded: a VPN that is not up or a missing table
# must never fail the removal. The agent is stopped first, so nothing brings the tunnel back.
nmcli connection down id nivuus-guest-vpn >/dev/null 2>&1 || true
nft delete table inet nivuus_guest_vpn >/dev/null 2>&1 || true
exit 0
