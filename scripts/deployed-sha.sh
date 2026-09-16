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
TOKEN=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['token'])" "$AUTH")

if [ $# -ge 1 ]; then
  ID="$1"
else
  ID=$(curl -fsS -H "Authorization: Bearer $TOKEN" \
        "https://api.vercel.com/v6/deployments?app=kitchenbooks&target=production&limit=1" \
       | python3 -c "import json,sys;d=json.load(sys.stdin)['deployments'];print(d[0]['uid'] if d else '')")
  [ -n "$ID" ] || { echo "No production deployment found" >&2; exit 1; }
fi

curl -fsS -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v13/deployments/$ID" \
 | python3 -c "
import json, sys
d = json.load(sys.stdin); m = d.get('meta') or {}
print('state   ', d.get('readyState'), '·', d.get('target'), '·', ','.join(d.get('regions') or []))
print('sha     ', m.get('githubCommitSha') or '(none — not a git deployment)')
print('branch  ', m.get('githubCommitRef') or '-')
print('message ', (m.get('githubCommitMessage') or '-').splitlines()[0][:72])
print('url      https://%s' % d.get('url'))
"
