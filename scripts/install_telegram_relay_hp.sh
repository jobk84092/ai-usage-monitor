#!/usr/bin/env bash
# Install user systemd unit for the AI Usage Telegram relay on HP Ubuntu.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/ai-usage-telegram-relay.service"
mkdir -p "$UNIT_DIR" "$HOME/.local/share/ai-usage-monitor"

PYTHON3="$(command -v python3)"
cat >"$UNIT" <<EOF
[Unit]
Description=AI Usage Monitor Telegram relay (localhost:8792)
After=network-online.target

[Service]
Type=simple
ExecStart=${PYTHON3} ${ROOT}/scripts/usage_telegram_relay.py serve
Restart=always
RestartSec=3
StandardOutput=append:%h/.local/share/ai-usage-monitor/relay.log
StandardError=append:%h/.local/share/ai-usage-monitor/relay.log

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now ai-usage-telegram-relay.service
sleep 1
curl -fsS "http://127.0.0.1:8792/health" && echo
echo "Installed ai-usage-telegram-relay.service"
