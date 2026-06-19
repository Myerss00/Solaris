#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="$SCRIPT_DIR/solaris-ui.service"

if [ ! -f "$SERVICE_FILE" ]; then
  echo "Error: solaris-ui.service not found in $SCRIPT_DIR"
  exit 1
fi

echo "Installing Solaris UI service..."
echo "Make sure you've edited solaris-ui.service with your username and paths first!"
echo ""

sudo cp "$SERVICE_FILE" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable solaris-ui
sudo systemctl start solaris-ui
sudo systemctl status solaris-ui
