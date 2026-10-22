#!/usr/bin/env bash
# Coder daily refresh. Writes ONLY data/<slug>/tracking.json (update.py) and data/morntide/pace.json (morntide_pace.py).
# latest.json, snapshots.json and chezerecta/ypp.json are owned by YCM routines: read here, never written.
set -euo pipefail
cd /workspace/analytics-desk
git pull --ff-only
python3 tools/update.py
python3 tools/morntide_pace.py
OWN=(data/chezerecta/tracking.json data/morntide/tracking.json data/morntide/pace.json)
git add -- "${OWN[@]}"
if git diff --cached --quiet -- "${OWN[@]}"; then echo "no changes"; exit 0; fi
git commit -m 'data: daily tracking/pace update' -- "${OWN[@]}"
git push origin main
