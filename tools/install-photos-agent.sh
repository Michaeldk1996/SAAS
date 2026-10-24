#!/bin/bash
# Installs the daily LaunchAgent for the self-hosted headshot refresh (tools/photos/refresh-photos.sh; founder
# 2026-10-24). Same shape as the career-splits job: launchd -> ~/.bsp-photos-cron/bootstrap.sh -> a dedicated clean
# clone of main -> the versioned refresh script. The script itself decides whether a refresh is due (weekly, or when the
# alias file changed). Idempotent: re-running replaces the bootstrap and the plist.
#   bash tools/install-photos-agent.sh            install + load
#   bash tools/install-photos-agent.sh --uninstall
set -euo pipefail
BASE="$HOME/.bsp-photos-cron"; LABEL="com.stennisfy.photos"; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true; rm -f "$PLIST"; echo "uninstalled $LABEL (logs kept in $BASE)"; exit 0
fi
mkdir -p "$BASE"
cat > "$BASE/bootstrap.sh" <<'EOS'
#!/bin/bash
# launchd entry for the headshot refresh: a dedicated clean clone of main, then the versioned script inside it.
set -euo pipefail
BASE="$HOME/.bsp-photos-cron"; REPO="$BASE/SAAS"
[ -d "$REPO/.git" ] || git clone --quiet https://github.com/Michaeldk1996/SAAS.git "$REPO"
cd "$REPO"
git fetch --quiet origin main
git checkout --quiet main 2>/dev/null || git checkout --quiet -B main origin/main
git reset --quiet --hard origin/main
[ -x tools/install-git-hooks.sh ] && bash tools/install-git-hooks.sh >/dev/null 2>&1 || true
exec /bin/bash tools/photos/refresh-photos.sh
EOS
chmod +x "$BASE/bootstrap.sh"
NODE_DIR="$(dirname "$(command -v node)")"
cat > "$PLIST" <<EOP
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$BASE/bootstrap.sh</string></array>
  <!-- Daily check at 07:15 local (the script refreshes only when due: weekly, or the alias file changed). If the Mac is
       asleep then, launchd runs it on the next wake. It needs the logged-in session: Chrome opens a small window. -->
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>15</integer></dict>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODE_DIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StandardOutPath</key><string>$BASE/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$BASE/launchd.err.log</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
EOP
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL: daily 07:15 check -> $BASE/bootstrap.sh (logs: $BASE/refresh.log, report.md, last-run.json)"
