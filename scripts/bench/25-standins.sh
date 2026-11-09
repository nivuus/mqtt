#!/usr/bin/env bash
# Runs INSIDE the bench VM after every boot (network namespaces do not persist).
set -euo pipefail

# OTBR stand-in: unmanaged tun, bound to trusted by trusted.xml as on the host.
ip link show wpan0 >/dev/null 2>&1 || ip tuntap add dev wpan0 mode tun
ip link set wpan0 up

# --- Stand-ins: a home device behind localBridge, a guest behind publicBridge -
mkns() { # name bridge-ifname host-end addr gw
  ip netns del "$1" 2>/dev/null || true
  ip link del "$3" 2>/dev/null || true
  ip netns add "$1"
  ip link add "$3" type veth peer name eth0 netns "$1"
  ip link set "$3" master "$2" up
  ip -n "$1" link set lo up
  ip -n "$1" link set eth0 up
  ip -n "$1" addr add "$4" dev eth0
  ip -n "$1" route add default via "$5"
  mkdir -p "/etc/netns/$1"
  echo "nameserver $5" > "/etc/netns/$1/resolv.conf"
}
mkns homedev localBridge homedev-h 192.168.0.50/24 192.168.0.1
ip -n homedev -6 addr add fd00:0:0:10::50/64 dev eth0
mkns guest publicBridge guest-h 192.168.2.50/24 192.168.2.1

# IPv6 on the guest side, to check that guest IPv6 never leaves via the uplink.
ip -6 addr replace fd00:0:0:20::1/64 dev publicBridge
ip -n guest -6 addr add fd00:0:0:20::50/64 dev eth0
ip -n guest -6 route add default via fd00:0:0:20::1
