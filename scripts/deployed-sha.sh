#!/usr/bin/env bash
# WHAT IS ACTUALLY SERVED — the first step of the diagnostic order, in one
# command.
#
# "Committed" is not "pushed" and "pushed" is not "deployed", and this project
# has lost four rounds to the difference. `git log` describes a laptop; the
# only authority is the host. `vercel inspect` does NOT print the commit SHA —
# not at 58.9.0 and not at 59.19.0 — so the CLI cannot answer this and the
# REST API has to.
#
#   ./scripts/deployed-sha.sh            # current production deployment
#   ./scripts/deployed-sha.sh <dpl_id>   # a specific one
#
# Reads the CLI's own OAuth token; prints no credential.
set -euo pipefail

AUTH="$HOME/Library/Application Support/com.vercel.cli/auth.json"
[ -f "$AUTH" ] || { echo "No Vercel CLI credential at $AUTH — run: vercel login" >&2; exit 1; }

# THE TOKEN EXPIRES, AND READING THE FILE DOES NOT REFRESH IT. The CLI holds a
# refresh token and renews on use; a script that reads auth.json directly gets
# whatever was last written, which 403s once the hour is up. So a cheap CLI
# call goes first purely for its side effect. Found the honest way: this script
# worked twice and then 403'd, 34 minutes after the expiry stamped in the file.
vercel whoami >/dev/null 2>&1 || true
TOKEN=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['token'])" "$AUTH")

api() {
  # -f makes curl exit non-zero on 4xx/5xx instead of piping an error page into
  # a JSON parser, which is how a 403 turned into a traceback.
  curl -fsS -H "Authorization: Bearer $TOKEN" "$@" || {
    echo "Vercel API refused the request — try: vercel login" >&2
    exit 1
  }
}

if [ $# -ge 1 ]; then
  ID="$1"
else
  ID=$(api "https://api.vercel.com/v6/deployments?app=kitchenbooks&target=production&limit=1" \
       | python3 -c "import json,sys;d=json.load(sys.stdin).get('deployments') or [];print(d[0]['uid'] if d else '')")
  [ -n "$ID" ] || { echo "No production deployment found" >&2; exit 1; }
fi

api "https://api.vercel.com/v13/deployments/$ID" \
 | python3 -c "
import json, sys
d = json.load(sys.stdin); m = d.get('meta') or {}
print('state   ', d.get('readyState'), '·', d.get('target'), '·', ','.join(d.get('regions') or []))
print('sha     ', m.get('githubCommitSha') or '(none — not a git deployment)')
print('branch  ', m.get('githubCommitRef') or '-')
print('message ', (m.get('githubCommitMessage') or '-').splitlines()[0][:72])
print('url      https://%s' % d.get('url'))
"
