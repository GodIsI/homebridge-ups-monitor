#!/usr/bin/env bash
# deploy.sh — install homebridge-ups-monitor from GitHub Releases
#
# Usage:
#   bash ~/homebridge-ups-monitor/scripts/deploy.sh          # latest stable
#   bash ~/homebridge-ups-monitor/scripts/deploy.sh --beta   # latest beta (pre-release)

set -euo pipefail

# Homebridge stores plugins under /var/lib/homebridge when run via hb-service
PLUGIN_DIR="/var/lib/homebridge/node_modules/homebridge-ups-monitor"
# Fall back to ~/.homebridge if the above doesn't exist
[ -d "/var/lib/homebridge/node_modules" ] || PLUGIN_DIR="$HOME/.homebridge/node_modules/homebridge-ups-monitor"
REPO="GodIsI/homebridge-ups-monitor"
CHANNEL="stable"

for arg in "$@"; do
  case $arg in
    --beta) CHANNEL="beta" ;;
    --stable) CHANNEL="stable" ;;
  esac
done

echo "Channel: $CHANNEL"

if [ "$CHANNEL" = "beta" ]; then
  # Latest pre-release
  RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases" \
    | grep -v '^#' \
    | python3 -c "
import sys, json
releases = json.load(sys.stdin)
pre = [r for r in releases if r.get('prerelease')]
if pre:
    print(json.dumps(pre[0]))
")
else
  # Latest stable release
  RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")
fi

if [ -z "$RELEASE_JSON" ]; then
  echo "No $CHANNEL release found on GitHub." >&2
  exit 1
fi

TAG=$(echo "$RELEASE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])")
URL=$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
assets = json.load(sys.stdin).get('assets', [])
tgz = [a for a in assets if a['name'].endswith('.tgz')]
print(tgz[0]['browser_download_url'] if tgz else '')
")

if [ -z "$URL" ]; then
  echo "No .tgz asset found in release $TAG." >&2
  exit 1
fi

echo "Installing $TAG from $URL..."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "$URL" -o "$TMP/plugin.tgz"
tar -xzf "$TMP/plugin.tgz" -C "$TMP"

rm -rf "$PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR"
cp -r "$TMP/package/." "$PLUGIN_DIR/"

# Install the UI dependency so server.js can find @homebridge/plugin-ui-utils
echo "Installing UI dependencies..."
cd "$PLUGIN_DIR"
npm install @homebridge/plugin-ui-utils --no-save --silent

echo ""
echo "✓ Installed $TAG to $PLUGIN_DIR"
echo "  Refresh the Homebridge UI dashboard to pick up changes."
echo "  For index.js changes, restart Homebridge: sudo hb-service restart"
