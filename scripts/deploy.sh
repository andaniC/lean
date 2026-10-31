#!/bin/sh
# Publishes public/ to GitHub Pages.
#   scripts/deploy.sh beta   -> https://andanic.github.io/lean/beta/  (own storage, "Lean Beta")
#   scripts/deploy.sh prod   -> https://andanic.github.io/lean/       (keeps beta/ in place)
set -e
CHANNEL="$1"
case "$CHANNEL" in beta|prod) ;; *) echo "usage: scripts/deploy.sh beta|prod" >&2; exit 1 ;; esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WT="$ROOT/.deploy"
cd "$ROOT"
git fetch -q origin gh-pages
rm -rf "$WT"
git worktree prune
git worktree add -q --detach "$WT" origin/gh-pages

if [ "$CHANNEL" = "beta" ]; then
  DEST="$WT/beta"
  rsync -a --delete --exclude ".DS_Store" public/ "$DEST/"
  # Separate storage, caches and name so beta never touches the live app's data.
  sed -i '' 's/export const STORAGE = "lean";/export const STORAGE = "lean-beta";/' "$DEST/config.js"
  sed -i '' 's/const CHANNEL = "lean";/const CHANNEL = "lean-beta";/' "$DEST/sw.js"
  sed -i '' 's/"name": "Lean – Calorie Tracker"/"name": "Lean Beta"/; s/"short_name": "Lean"/"short_name": "Lean Beta"/' "$DEST/manifest.webmanifest"
  sed -i '' 's|<title>Lean</title>|<title>Lean Beta</title>|; s|content="Lean" />|content="Lean Beta" />|; s|<h1 class="brand">Lean</h1>|<h1 class="brand">Lean <span class="beta-tag">beta</span></h1>|' "$DEST/index.html"
  grep -q 'STORAGE = "lean-beta"' "$DEST/config.js" && grep -q 'CHANNEL = "lean-beta"' "$DEST/sw.js" || { echo "beta rewrite failed" >&2; exit 1; }
else
  rsync -a --delete --exclude ".DS_Store" --exclude "beta/" --exclude ".git" public/ "$WT/"
fi

cd "$WT"
git add -A
if git diff --cached --quiet; then
  echo "Nothing to deploy."
else
  git commit -q -m "Deploy $CHANNEL from $(git -C "$ROOT" rev-parse --short HEAD)"
  git push -q origin HEAD:gh-pages
  echo "Deployed $CHANNEL."
fi
cd "$ROOT"
git worktree remove --force "$WT"
