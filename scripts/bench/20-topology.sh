#!/usr/bin/env bash
# Runs INSIDE the bench VM, once, after 10-install.sh and after the host's
# /etc/firewalld copy has been unpacked to /root/host-firewalld.
#
# Mirrors the live host: same interface names, same NM zones, same firewalld
# zones/policies/services/direct rules. Only difference: the uplink is the
# QEMU user-net NIC enp0s2 (host: enp5s0.832), unmanaged by NM like the host's.
set -euo pipefail
export LC_ALL=C

# --- NetworkManager: same conf.d as the host ---------------------------------
cat > /etc/NetworkManager/conf.d/base.conf <<'EOF'
[main]
dns=none
plugins=keyfile
firewall-backend=none

[keyfile]
unmanaged-devices=interface-name:enp0s2;interface-name:homedev-h;interface-name:guest-h;interface-name:wpan0
EOF
systemctl restart NetworkManager

# --- firewalld: the host's permanent config, uplink renamed -------------------
systemctl stop firewalld
rm -rf /etc/firewalld
cp -a /root/host-firewalld /etc/firewalld
sed -i 's#<interface name="enp5s0.832"/>#<interface name="enp0s2"/>#' /etc/firewalld/zones/external.xml
grep -q 'interface name="enp0s2"' /etc/firewalld/zones/external.xml

# --- Docker: same daemon.json as the host -------------------------------------
cat > /etc/docker/daemon.json <<'EOF'
{ "iptables": false, "log-driver": "json-file" }
EOF

systemctl start firewalld
systemctl restart docker

# --- NM profiles with the host's names and zones ------------------------------
nmc() { nmcli connection add save yes "$@" >/dev/null; }

nmc type bridge con-name bridge-localBridge ifname localBridge connection.zone home \
  ipv4.method shared ipv4.addresses 192.168.0.1/24 \
  ipv6.method manual ipv6.addresses fd00:0:0:10::1/64 bridge.stp no
nmc type dummy con-name bridge-slave-enp15s0 ifname enp15s0 connection.zone home \
  connection.master localBridge connection.slave-type bridge

nmc type bridge con-name bridge-publicBridge ifname publicBridge connection.zone public \
  ipv4.method shared ipv4.addresses 192.168.2.1/24 ipv6.method ignore bridge.stp no

nmc type bridge con-name bridge-internalBridge ifname internalBridge connection.zone internal \
  ipv4.method shared ipv4.addresses 192.168.3.1/24 ipv6.method ignore bridge.stp no
nmc type tun con-name vnet17 ifname vnet17 connection.zone internal tun.mode tap \
  connection.master internalBridge connection.slave-type bridge

nmc type dummy con-name enp5s0 ifname enp5s0 connection.zone drop \
  ipv4.method disabled ipv6.method disabled
nmc type vlan con-name enp5s0.835 ifname enp5s0.835 vlan.parent enp5s0 vlan.id 835 \
  connection.zone drop ipv4.method disabled ipv6.method disabled
# wpan0 (OTBR) is not an NM profile on the host: firewalld keeps it in trusted
# from trusted.xml. It is created unmanaged by 25-standins.sh.

for c in bridge-localBridge bridge-slave-enp15s0 bridge-publicBridge bridge-internalBridge \
         vnet17 enp5s0 enp5s0.835; do
  nmcli connection up "$c" >/dev/null
done

# --- Docker networks: the host has docker0 + 19 user bridges in zone docker ---
for i in $(seq 1 19); do
  docker network inspect "bench$i" >/dev/null 2>&1 || \
    docker network create --driver bridge --subnet "172.$((30 + i)).0.0/16" "bench$i" >/dev/null
done

firewall-cmd --get-active-zones
