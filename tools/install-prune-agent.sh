#!/usr/bin/env bash
# Installs the daily space report (founder 2026-10-22): a LaunchAgent that runs tools/prune-agent-space.sh in REPORT-ONLY
# mode every day at 06:30 local. The script is copied to ~/.stennisfy/prune-agent-space.sh (the agent must not depend on
# which commit a checkout is on). Re-run after the script changes. Deletion stays a manual `--apply` until the founder
# approves it. Uninstall: launchctl unload ~/Library/LaunchAgents/com.stennisfy.prune-report.plist && rm that file.
set -eu
TOP="$(git rev-parse --show-toplevel)"
DEST="$HOME/.stennisfy/prune-agent-space.sh"
PLIST="$HOME/Library/LaunchAgents/com.stennisfy.prune-report.plist"
mkdir -p "$HOME/.stennisfy/prune-reports"
cp "$TOP/tools/prune-agent-space.sh" "$DEST"; chmod +x "$DEST"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.stennisfy.prune-report</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DEST</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/local/bin:/usr/bin:/bin:/usr/sbin</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$HOME/.stennisfy/prune-reports/agent.out</string>
  <key>StandardErrorPath</key><string>$HOME/.stennisfy/prune-reports/agent.err</string>
</dict></plist>
EOF
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "installed: $PLIST → $DEST (report only, daily 06:30 local); reports in $HOME/.stennisfy/prune-reports"
