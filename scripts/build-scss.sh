#!/usr/bin/env bash
# scripts/build-scss.sh
# Compiles every theme's .scss to .css using Dart Sass.
# Run from repo root:   bash scripts/build-scss.sh
# The repo's package.json `build` script only runs `tsc`. SCSS is pre-compiled
# per-repo convention — the AqualinkD theme follows the same convention.

set -euo pipefail

if ! command -v sass >/dev/null 2>&1; then
  echo "Dart Sass not found on PATH. Install with:  npm i -g sass" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

compile_one() {
  local theme="$1"
  local src="$REPO_ROOT/themes/$theme/theme.scss"
  local dst="$REPO_ROOT/themes/$theme/theme.css"
  if [[ -f "$src" ]]; then
    echo "sass $theme/theme.scss -> $theme/theme.css"
    sass --no-source-map --style=expanded "$src" "$dst"
  fi
}

# Compile every theme directory that has a theme.scss
while IFS= read -r -d '' theme_dir; do
  theme="$(basename "$theme_dir")"
  compile_one "$theme"
done < <(find "$REPO_ROOT/themes" -mindepth 1 -maxdepth 1 -type d -print0)

# Also compile top-level themes/*.scss (dashboard.scss, controller.scss, etc.)
while IFS= read -r -d '' src; do
  base="$(basename "$src" .scss)"
  dst="$(dirname "$src")/$base.css"
  echo "sass $(realpath --relative-to="$REPO_ROOT" "$src") -> $(basename "$dst")"
  sass --no-source-map --style=expanded "$src" "$dst"
done < <(find "$REPO_ROOT/themes" -maxdepth 1 -name "*.scss" -print0)

echo "Done."
