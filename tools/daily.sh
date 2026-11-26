#!/usr/bin/env bash
# Coder daily refresh. Writes ONLY data/<slug>/tracking.json (update.py), data/morntide/pace.json (morntide_pace.py)
# and data/{chezerecta,morntide,flbh}/web.json (web_update.py; needs GOOGLE_APPLICATION_CREDENTIALS in the environment).
# latest.json, snapshots.json and chezerecta/ypp.json are owned by YCM routines: read here, never written.
set -euo pipefail
cd /workspace/analytics-desk
git pull --ff-only
python3 tools/update.py
python3 tools/morntide_pace.py

SEO_API_DIR="${SEO_API_DIR:-/workspace/seo-api}"
VENV="${SEO_API_DIR}/venv-keep"
REQ="${SEO_API_DIR}/requirements.txt"
ensure_seo_venv() {
  if [ ! -x "${VENV}/bin/python" ]; then
    echo "seo-api venv missing; recreating at ${VENV}"
    python3 -m venv "${VENV}"
    "${VENV}/bin/pip" install --upgrade pip
    if [ -f "${REQ}" ]; then
      "${VENV}/bin/pip" install -r "${REQ}"
    else
      "${VENV}/bin/pip" install google-api-python-client google-analytics-data google-auth
    fi
  fi
  # Legacy path for other callers; box refresh can wipe this dot-named folder.
  local legacy="${SEO_API_DIR}/.venv"
  if [ -L "${legacy}" ] || [ ! -e "${legacy}" ]; then
    ln -sfn "${VENV}" "${legacy}"
  fi
}

if [ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]; then
  ensure_seo_venv
  "${VENV}/bin/python" tools/web_update.py
else
  echo "web_update skipped: GOOGLE_APPLICATION_CREDENTIALS not set"
fi

OWN=(data/chezerecta/tracking.json data/morntide/tracking.json data/morntide/pace.json data/chezerecta/web.json data/morntide/web.json data/flbh/web.json)
git add -- "${OWN[@]}"
if git diff --cached --quiet -- "${OWN[@]}"; then echo "no changes"; exit 0; fi
git commit -m 'data: daily tracking/pace/web update' -- "${OWN[@]}"
git push origin main
