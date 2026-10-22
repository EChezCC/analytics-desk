#!/usr/bin/env bash
# Daily analytics-desk refresh: pull fresh Studio figures from the old desks (read-only), rebuild, commit if changed.
set -euo pipefail
cd /workspace/analytics-desk
git pull --ff-only
sync() { # repo slug files...
  local repo=$1 slug=$2; shift 2
  local src=/tmp/src/$repo
  [ -d "$src/.git" ] || git clone -q "https://github.com/EChezCC/$repo.git" "$src"
  git -C "$src" fetch -q origin main
  for f in "$@"; do git -C "$src" show "origin/main:data/$f" > "data/$slug/$f"; done
}
sync chezerecta-desk chezerecta latest.json snapshots.json ypp.json
sync morntide-desk morntide latest.json snapshots.json
python3 tools/update.py
python3 tools/morntide_pace.py
git add data tools/daily.sh
if git diff --cached --quiet; then echo "no changes"; exit 0; fi
git commit -m 'data: daily update'
git push origin main
