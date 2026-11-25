#!/usr/bin/env bash
# Install LaunchAgent so the AI Usage Telegram relay stays up on Mac.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.jobkimani.ai-usage-telegram-relay"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs"
mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents" "$HOME/.local/share/ai-usage-monitor"

PYTHON3="$(command -v python3)"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PYTHON3}</string>
    <string>${ROOT}/scripts/usage_telegram_relay.py</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_DIR}/ai-usage-telegram-relay.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/ai-usage-telegram-relay.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null || launchctl load "$PLIST"
sleep 1
curl -fsS "http://127.0.0.1:8792/health" && echo
echo "Installed ${LABEL}"
