#!/usr/bin/env bash
# Runs INSIDE the bench VM. Installs the same package versions as the host:
# NetworkManager 1.52.1, firewalld 2.3.1 (nftables backend), nftables 1.1.3,
# network-manager-openvpn 1.12.3, docker-ce 29.9.3.
set -euo pipefail
export LC_ALL=C DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq network-manager firewalld network-manager-openvpn openvpn \
  curl ca-certificates dnsutils tcpdump iproute2 >/dev/null

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian trixie stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -qq
DOCKER_VERSION="5:29.9.3-1~debian.13~trixie"
apt-get install -y -qq "docker-ce=$DOCKER_VERSION" "docker-ce-cli=$DOCKER_VERSION" containerd.io >/dev/null

dpkg -l network-manager firewalld nftables python3-nftables network-manager-openvpn docker-ce \
  | awk '/^ii/ {print $2, $3}'
