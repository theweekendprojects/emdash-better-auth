#!/usr/bin/env bash
#
# local-install.sh — test an unpublished plugin build in the landing page
# using a REAL npm install (packed tarball), not a source copy or workspace link.
#
# This installs exactly what `npm publish` would ship (the `files` allowlist),
# so local testing matches what npm consumers get. No source is copied into the
# consuming site; only the built tarball is installed.
#
# Usage:
#   bash scripts/local-install.sh                       # pack this repo, install into the default landing page
#   bash scripts/local-install.sh /path/to/consuming-site
#
# After running, build/deploy the consuming site to verify:
#   cd <site> && pnpm build      (or pnpm deploy)
#
# Requirements: Node >= 22 (pinned pnpm needs it), pnpm, npm.
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SITE_DIR="${1:-$HOME/Documents/GitHub/theweekendprojects-landing-page}"

# Ensure Node >= 22 is on PATH (nvm layout). Adjust if your version differs.
NODE22="$HOME/.nvm/versions/node/v22.23.2/bin"
[ -d "$NODE22" ] && export PATH="$NODE22:$PATH"
echo "node: $(node -v)"

[ -d "$SITE_DIR" ] || { echo "ERROR: consuming site not found: $SITE_DIR"; exit 1; }
[ -f "$PLUGIN_DIR/package.json" ] || { echo "ERROR: no package.json in $PLUGIN_DIR"; exit 1; }

NAME=$(node -p "require('$PLUGIN_DIR/package.json').name")
VER=$(node -p "require('$PLUGIN_DIR/package.json').version")
echo "==> Packing $NAME@$VER from $PLUGIN_DIR"

# 1. Pack the plugin into a versioned tarball (exactly what npm would publish).
cd "$PLUGIN_DIR"
TARBALL_NAME=$(npm pack 2>/dev/null | tail -1)
TARBALL_PATH="$PLUGIN_DIR/$TARBALL_NAME"
echo "==> Built tarball: $TARBALL_PATH"

# 2. Install the tarball into the consuming site as a normal dependency.
#    pnpm rewrites the dependency to `file:<tarball>` and installs its contents
#    into node_modules — a real install, no symlink to source.
cd "$SITE_DIR"
echo "==> Installing $NAME from tarball into $SITE_DIR"
pnpm add "$TARBALL_PATH"

echo
echo "==> Done. $NAME is now installed from the packed tarball."
echo "    Verify with:  cd \"$SITE_DIR\" && pnpm build"
echo
echo "NOTE: package.json in the site now points at file:$TARBALL_NAME (local test)."
echo "      To go back to the published npm version, run:"
echo "        cd \"$SITE_DIR\" && pnpm add $NAME@latest"
