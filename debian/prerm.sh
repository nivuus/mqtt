#!/bin/sh
set -e
# Stop and disable the service
systemctl stop mqtt-system-agent.service
systemctl disable mqtt-system-agent.service
exit 0
