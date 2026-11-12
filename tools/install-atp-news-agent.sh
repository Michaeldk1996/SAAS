#!/bin/bash
# News ticker — installs (or removes) the LaunchAgent that runs the ATP reader every 30 minutes on this Mac
# (founder 2026-11-12). A small Chrome window opens for about a minute each run; it needs the logged-in session.
#   bash tools/install-atp-news-agent.sh              install / reinstall
#   bash tools/install-atp-news-agent.sh --uninstall  remove (logs kept)
set -euo pipefail
BASE="$HOME/.stennisfy-atp-news"; LABEL="com.stennisfy.atp-news"; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true; rm -f "$PLIST"; echo "uninstalled $LABEL (logs kept in $BASE)"; exit 0
fi
mkdir -p "$BASE"
cat > "$BASE/bootstrap.sh" <<'EOS'
#!/bin/bash
set -euo pipefail
BASE="$HOME/.stennisfy-atp-news"; REPO="$BASE/SAAS"
[ -d "$REPO/.git" ] || git clone --quiet https://github.com/Michaeldk1996/SAAS.git "$REPO"
cd "$REPO"
git fetch --quiet origin main
git checkout --quiet main 2>/dev/null || git checkout --quiet -B main origin/main
git reset --quiet --hard origin/main
[ -x tools/install-git-hooks.sh ] && bash tools/install-git-hooks.sh >/dev/null 2>&1 || true
exec /bin/bash tools/news-ticker/refresh-atp.sh
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
  <key>StartInterval</key><integer>1800</integer>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODE_DIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StandardOutPath</key><string>$BASE/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$BASE/launchd.err.log</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
EOP
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL: every 30 minutes -> $BASE/bootstrap.sh (logs: $BASE/refresh.log, last-run.json)"
