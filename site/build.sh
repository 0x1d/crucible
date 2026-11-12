#!/usr/bin/env bash
# crucible/development section 3.2
#
# Builds the documentation site with Quartz: collects the documentation
# folders (site/collect.py) and renders them to static HTML.
#
# Usage: site/build.sh [output-dir]   (default: site/public)
set -euo pipefail

QUARTZ_REPO=https://github.com/jackyzha0/quartz.git
QUARTZ_REF=v5.1.0

root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
site=$root/site
work=$site/.quartz
out=$(realpath -m "${1:-$site/public}")

# init and fetch rather than clone: a restored plugin cache may already
# have created $work.
[ -d "$work/.git" ] || git init --quiet "$work"
if [ "$(cat "$work/.git/crucible-ref" 2>/dev/null)" != "$QUARTZ_REF" ]; then
  git -C "$work" fetch --quiet --depth 1 "$QUARTZ_REPO" "refs/tags/$QUARTZ_REF"
  git -C "$work" -c advice.detachedHead=false checkout --quiet --force FETCH_HEAD
  echo "$QUARTZ_REF" > "$work/.git/crucible-ref"
fi

cp "$site/quartz.config.yaml" "$work/quartz.config.yaml"
if [ -f "$site/quartz.lock.json" ]; then
  cp "$site/quartz.lock.json" "$work/quartz.lock.json"
fi

python3 "$site/collect.py" "$root" "$work/content" \
  "https://github.com/0x1d/crucible/blob/${GITHUB_SHA:-main}"

cd "$work"
npm ci --no-audit --no-fund
npx quartz plugin install
npx quartz build --directory content --output "$out"
