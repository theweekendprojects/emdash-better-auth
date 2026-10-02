#!/usr/bin/env bash
#
# selfcheck.sh — run the dependency-free unit self-checks for this plugin.
#
# These cover the pure logic that would otherwise only be exercised inside a
# consuming EmDash site: the where-pushdown split, the users.data additional-
# field merge, the settings resolution (incl. teams-gated-by-org), and the
# org/membership uniqueness decision.
#
# They do NOT need better-auth / emdash / kysely installed — each self-check
# imports only a dependency-free src module. settings.ts imports one type from
# "emdash", so a tiny local stub is provided for that compile only.
#
# Usage:  bash scripts/selfcheck.sh
# Requires: a `tsc` (project devDependency `typescript`, or a global one).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
STUB="$OUT/emdash-stub"
trap 'rm -rf "$OUT"' EXIT

# Resolve tsc: prefer the project's installed binary, else a global one.
if [ -x "$ROOT/node_modules/.bin/tsc" ]; then
	TSC="$ROOT/node_modules/.bin/tsc"
elif command -v tsc >/dev/null 2>&1; then
	TSC="tsc"
else
	echo "ERROR: no tsc found. Run 'pnpm install' (adds the typescript devDep) first." >&2
	exit 1
fi

# Minimal stub for the single type settings.ts imports from "emdash".
mkdir -p "$STUB"
cat > "$STUB/index.d.ts" <<'EOF'
export type KVAccess = {
	get<T = unknown>(k: string): Promise<T | null>;
	set(k: string, v: unknown): Promise<void>;
	delete(k: string): Promise<void>;
};
EOF
echo 'export {};' > "$STUB/index.js"

cat > "$OUT/tsconfig.json" <<EOF
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2022",
    "strict": true,
    "skipLibCheck": true,
    "types": [],
    "outDir": "$OUT/js",
    "rootDir": "$ROOT",
    "paths": { "emdash": ["$STUB/index.d.ts"] }
  },
  "files": [
    "$ROOT/src/where-pushdown.ts",
    "$ROOT/src/additional-data.ts",
    "$ROOT/src/unique-constraint.ts",
    "$ROOT/src/settings.ts",
    "$ROOT/scripts/where-pushdown.selfcheck.ts",
    "$ROOT/scripts/additional-data.selfcheck.ts",
    "$ROOT/scripts/unique-constraint.selfcheck.ts",
    "$ROOT/scripts/settings-resolve.selfcheck.ts"
  ]
}
EOF

echo "==> Compiling self-checks with $TSC"
"$TSC" -p "$OUT/tsconfig.json"

echo '{"type":"module"}' > "$OUT/js/package.json"

echo "==> Running self-checks"
node "$OUT/js/scripts/where-pushdown.selfcheck.js"
node "$OUT/js/scripts/additional-data.selfcheck.js"
node "$OUT/js/scripts/unique-constraint.selfcheck.js"
node "$OUT/js/scripts/settings-resolve.selfcheck.js"

echo "==> All self-checks passed"
