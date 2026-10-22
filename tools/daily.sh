#!/usr/bin/env bash
# Coder daily refresh. Writes ONLY data/<slug>/tracking.json (update.py), data/morntide/pace.json (morntide_pace.py)
# and data/{chezerecta,morntide,flbh}/web.json (web_update.py; needs GOOGLE_APPLICATION_CREDENTIALS in the environment).
# latest.json, snapshots.json and chezerecta/ypp.json are owned by YCM routines: read here, never written.
set -euo pipefail
cd /workspace/analytics-desk
git pull --ff-only
python3 tools/update.py
python3 tools/morntide_pace.py
if [ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]; then /workspace/seo-api/.venv/bin/python tools/web_update.py; else echo "web_update skipped: GOOGLE_APPLICATION_CREDENTIALS not set"; fi
OWN=(data/chezerecta/tracking.json data/morntide/tracking.json data/morntide/pace.json data/chezerecta/web.json data/morntide/web.json data/flbh/web.json)
git add -- "${OWN[@]}"
if git diff --cached --quiet -- "${OWN[@]}"; then echo "no changes"; exit 0; fi
git commit -m 'data: daily tracking/pace/web update' -- "${OWN[@]}"
git push origin main
