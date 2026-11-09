#!/bin/sh
set -e

# Define service name and paths
SERVICE_NAME="mqtt-system-agent.service"
SYSTEM_SERVICE_FILE_PATH="/etc/systemd/system/${SERVICE_NAME}"
PACKAGE_SERVICE_FILE_PATH="/lib/systemd/system/${SERVICE_NAME}" # Path where dpkg installs service files

echo "Running post-installation script for ${SERVICE_NAME}..."

# Stop and disable the service if it's already running
echo "Attempting to stop and disable any existing ${SERVICE_NAME}..."
systemctl stop "${SERVICE_NAME}" || true # Continue if already stopped
systemctl disable "${SERVICE_NAME}" || true # Continue if already disabled

# Remove any existing service file from /etc/systemd/system to avoid conflicts
# This is important if a user manually created or symlinked a service file there.
if [ -L "${SYSTEM_SERVICE_FILE_PATH}" ] || [ -f "${SYSTEM_SERVICE_FILE_PATH}" ]; then
  echo "Removing existing service file/symlink from ${SYSTEM_SERVICE_FILE_PATH}..."
  rm -f "${SYSTEM_SERVICE_FILE_PATH}"
fi

# Also check for a potentially problematic file in /usr/local/lib/systemd/system
USR_LOCAL_SERVICE_FILE_PATH="/usr/local/lib/systemd/system/${SERVICE_NAME}"
if [ -f "${USR_LOCAL_SERVICE_FILE_PATH}" ]; then
  echo "Warning: Found a service file at ${USR_LOCAL_SERVICE_FILE_PATH}."
  echo "This might conflict. If problems persist, please remove it manually."
  # We won't remove it automatically as it's outside typical package management paths for /etc
fi

# Ensure the target directory for config exists
mkdir -p /opt/mqtt-system-agent/config
echo "Ensured /opt/mqtt-system-agent/config directory exists."

# Reload systemd to recognize changes
echo "Reloading systemd daemon..."
systemctl daemon-reload

# Enable by unit NAME, never by path: with merged /usr, /lib/systemd/system is not a unit
# search path, so `systemctl enable /lib/...` links the unit into /etc/systemd/system as a
# foreign file; `systemctl disable` (prerm) then refuses it and `dpkg -P` fails.
if [ -f "${PACKAGE_SERVICE_FILE_PATH}" ]; then
  echo "Enabling ${SERVICE_NAME}..."
  systemctl enable "${SERVICE_NAME}"
  echo "Starting ${SERVICE_NAME}..."
  systemctl start "${SERVICE_NAME}"
else
  echo "Error: Packaged service file ${PACKAGE_SERVICE_FILE_PATH} not found. Cannot enable service."
  exit 1
fi

echo "Post-installation script for ${SERVICE_NAME} completed."
exit 0
