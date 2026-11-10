#!/usr/bin/env bash
# Copy the Home Assistant dashboard strategy into HA's www/ directory.
#
# Each deployment lands in its own directory named after the commit, so the
# browser never mixes a cached module with a new one: the ES modules import
# each other by relative path, which a ?v= query on the entry cannot reach.
# Prints the resource URL to register (Settings > Dashboards > Resources,
# type "JavaScript module").
#
# Usage: HA_CONFIG=/opt/nivuus/home-manager/config scripts/deploy-ha-dashboard.sh
set -euo pipefail

: "${HA_CONFIG:?set HA_CONFIG to the Home Assistant configuration directory}"
repo=$(cd "$(dirname "$0")/.." && pwd)
rev=$(git -C "$repo" rev-parse --short HEAD)
if [ -n "$(git -C "$repo" status --porcelain -- ha-dashboard)" ]; then
  rev="$rev-dirty-$(date +%s)"
fi

dest="$HA_CONFIG/www/nivuus-server/$rev"
mkdir -p "$dest"
cp -r "$repo/ha-dashboard/src/." "$dest/"
chmod -R a+rX "$dest"
echo "/local/nivuus-server/$rev/nivuus-server.js"
