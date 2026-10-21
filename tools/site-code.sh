#!/usr/bin/env bash
# tools/site-code.sh <src> <site> — copy the site's CODE (pages, scripts, stylesheets, image assets) from the
# checkout <src> into the site directory <site>. Everything else the site serves is DATA, built by pipeline.yml.
#
# publish.yml calls it to lay the newest GATED code over the newest data the pipeline built, so a code change goes
# live without waiting for a data rebuild (founder 2026-10-12, "do not mix the data with it").
# It is the CODE part of pipeline.yml's "Assemble site", line for line: tools/test-publish-split.js fails when the two
# lists differ (a code file added to one and not the other), so a new page or script must be added to both.
set -euo pipefail
SRC="${1:?usage: site-code.sh <src> <site>}"
SITE="${2:?usage: site-code.sh <src> <site>}"
mkdir -p "$SITE"
SITE="$(cd "$SITE" && pwd)"   # absolute: the copies below run from <src>
cd "$SRC"
cp bsp-consult-dashboard.html "$SITE/index.html"
cp bsp-consult-dashboard.html "$SITE/bsp-consult-dashboard.html"
cp auth.html account.html funnel.html verify.html auth.js analytics.js "$SITE/"
mkdir -p "$SITE/assets" && cp assets/logo-dark-transparent.png assets/ring-transparent.png "$SITE/assets/"
mkdir -p "$SITE/assets/brand" && cp assets/brand/google-g.svg assets/brand/apple-white.png assets/brand/app-store-badge.svg assets/brand/google-play-badge.png "$SITE/assets/brand/"
cp house-ratings.js "$SITE/"
cp live-tab.js "$SITE/"
cp kibl-now-stream.js "$SITE/"
cp price-history-box.js "$SITE/"
cp holdbreak-heatmap.js "$SITE/"
cp player-profile-v2.js "$SITE/"
cp market-edge-core.js "$SITE/"
cp tournament-identity.js "$SITE/"
cp h2h-core.js "$SITE/"
cp wue-sheet.js "$SITE/"
cp draw-view.js "$SITE/"
cp esc-nav.js "$SITE/"
cp admin.html admin-config.js "$SITE/" 2>/dev/null || true
cp trading-report.js "$SITE/" 2>/dev/null || true
cp series.js series.css "$SITE/" 2>/dev/null || true
cp tokens.css theme.js "$SITE/"
cp drops-page.js drops-page.css "$SITE/" 2>/dev/null || true
