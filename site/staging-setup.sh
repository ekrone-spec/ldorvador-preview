#!/usr/bin/env bash
# One-time staging provisioning. Needs CLOUDFLARE_API_TOKEN in the environment.
# Safe to re-run. Optional: STAGING_REVIEWERS="a@x.com,b@y.com"
set -euo pipefail
cd "$(dirname "$0")"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is not set. Export a token with Account/Zone read, D1 edit, Access apps+policies edit, Turnstile edit, Workers edit.}"
export CLOUDFLARE_API_TOKEN
DOMAIN="ldorvadortravel.com"
HOST="staging.ldorvadortravel.com"
SITEKEY="0x4AAAAAAEobauMj4oBBez0V"
REVIEWERS="${STAGING_REVIEWERS:-connect@ldorvadortravel.com,erik@tcstudio.io}"
APP_NAME="L'Dor Vador staging admin"
POLICY_NAME="Reviewers"
API="https://api.cloudflare.com/client/v4"

# api METHOD PATH [JSON]  -> prints response JSON; dies on success=false
api() {
  local method="$1" path="$2" body="${3:-}" out
  if [ -n "$body" ]; then
    out=$(curl -sS -X "$method" "$API$path" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" --data "$body")
  else
    out=$(curl -sS -X "$method" "$API$path" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
  fi
  if ! printf '%s' "$out" | python3 -c 'import sys,json; sys.exit(0 if json.load(sys.stdin).get("success") else 1)' 2>/dev/null; then
    echo "FAIL: $method $path -> $(printf '%s' "$out" | head -c 600)" >&2
    exit 1
  fi
  printf '%s' "$out"
}
jq_() { python3 -c "import sys,json; d=json.load(sys.stdin); $1"; }

# a. account + zone
ACCOUNT_ID=$(api GET /accounts | jq_ 'r=d["result"]; print(r[0]["id"] if len(r)==1 else "")') 
if [ -z "$ACCOUNT_ID" ]; then
  echo "FAIL: token sees zero or multiple accounts; set CLOUDFLARE_ACCOUNT_ID" >&2
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || exit 1
  ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
fi
ZONE_ID=$(api GET "/zones?name=$DOMAIN" | jq_ 'r=d["result"]; print(r[0]["id"] if r else "")')
[ -n "$ZONE_ID" ] || { echo "FAIL: token cannot see zone $DOMAIN" >&2; exit 1; }
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
echo "a. account=$ACCOUNT_ID zone=$ZONE_ID"

# b. D1
D1_ID=$(npx wrangler d1 list --json | python3 -c 'import sys,json; print(next((x["uuid"] for x in json.load(sys.stdin) if x["name"]=="ldorvador-staging"),""))')
if [ -z "$D1_ID" ]; then
  npx wrangler d1 create ldorvador-staging >/dev/null
  D1_ID=$(npx wrangler d1 list --json | python3 -c 'import sys,json; print(next(x["uuid"] for x in json.load(sys.stdin) if x["name"]=="ldorvador-staging"))')
  D1_NOTE="created"
else D1_NOTE="exists"; fi
python3 - "$D1_ID" <<'PY'
import sys
p="wrangler.jsonc"; s=open(p).read()
s=s.replace("REPLACE_WITH_STAGING_D1_ID", sys.argv[1]); open(p,"w").write(s)
PY
for f in migrations/*.sql; do
  # Migrations are not all re-runnable; tolerate "already exists"/duplicate column on re-run.
  if ! out=$(npx wrangler d1 execute ldorvador-staging --remote --file="$f" -y 2>&1); then
    if printf '%s' "$out" | grep -qiE 'already exists|duplicate column'; then echo "   $f already applied"; else echo "$out" >&2; exit 1; fi
  fi
done
echo "b. D1 ldorvador-staging $D1_NOTE id=$D1_ID, migrations applied"

# c. Access app
OTP_ID=$(api GET "/accounts/$ACCOUNT_ID/access/identity_providers" | jq_ 'print(next((i["id"] for i in d["result"] if i["type"]=="onetimepin"),""))')
[ -n "$OTP_ID" ] || { echo "FAIL: no one-time PIN identity provider in this account's Zero Trust" >&2; exit 1; }
INCLUDE=$(python3 -c 'import sys,json; print(json.dumps([{"email":{"email":e.strip()}} for e in sys.argv[1].split(",") if e.strip()]))' "$REVIEWERS")
POLICY_ID=$(api GET "/accounts/$ACCOUNT_ID/access/policies" | jq_ 'print(next((p["id"] for p in d["result"] if p["name"]=="'"$POLICY_NAME"'"),""))')
if [ -z "$POLICY_ID" ]; then
  POLICY_ID=$(api POST "/accounts/$ACCOUNT_ID/access/policies" "$(python3 -c 'import sys,json; print(json.dumps({"name":sys.argv[1],"decision":"allow","include":json.loads(sys.argv[2]),"session_duration":"24h"}))' "$POLICY_NAME" "$INCLUDE")" | jq_ 'print(d["result"]["id"])')
  P_NOTE="policy created"
else P_NOTE="policy exists (not modified)"; fi
APP_JSON=$(api GET "/accounts/$ACCOUNT_ID/access/apps" | python3 -c 'import sys,json; n=sys.argv[1]; print(json.dumps(next((a for a in json.load(sys.stdin)["result"] if a.get("name")==n),{})))' "$APP_NAME")
AUD=$(printf '%s' "$APP_JSON" | jq_ 'print(d.get("aud",""))')
if [ -z "$AUD" ]; then
  BODY=$(python3 - "$APP_NAME" "$HOST" "$POLICY_ID" "$OTP_ID" <<'PY'
import sys,json
name,host,pol,otp=sys.argv[1:5]
print(json.dumps({"name":name,"type":"self_hosted","domain":host+"/admin","session_duration":"24h",
 "destinations":[{"type":"public","uri":host+p} for p in ("/admin","/api/admin","/api/interest")],
 "allowed_idps":[otp],"policies":[{"id":pol,"precedence":1}]}))
PY
)
  AUD=$(api POST "/accounts/$ACCOUNT_ID/access/apps" "$BODY" | jq_ 'print(d["result"]["aud"])')
  A_NOTE="app created"
else A_NOTE="app exists"; fi
python3 - "$AUD" <<'PY'
import sys
p="wrangler.jsonc"; s=open(p).read()
s=s.replace("REPLACE_WITH_STAGING_ACCESS_AUD", sys.argv[1]); open(p,"w").write(s)
PY
echo "c. Access: $A_NOTE, $P_NOTE, aud=$AUD"

# d. Turnstile
W=$(api GET "/accounts/$ACCOUNT_ID/challenges/widgets/$SITEKEY")
NEW=$(printf '%s' "$W" | python3 -c 'import sys,json; r=json.load(sys.stdin)["result"]; d=r["domains"]; h=sys.argv[1]
if h in d: print("")
else:
  keep={k:r[k] for k in ("name","mode","bot_fight_mode","clearance_level","region","offlabel","ephemeral_id") if k in r and r[k] is not None}
  keep["domains"]=d+[h]; print(json.dumps(keep))' "$HOST")
if [ -z "$NEW" ]; then echo "d. Turnstile: $HOST already listed"
else api PUT "/accounts/$ACCOUNT_ID/challenges/widgets/$SITEKEY" "$NEW" >/dev/null; echo "d. Turnstile: added $HOST"; fi

# e. build + deploy, then restore production build
PROD=0 SITE="https://$HOST" LDV_BOOKINGS_FORCE_OPEN=1 python3 build.py
npx wrangler deploy --env staging
python3 build.py
echo "e. deployed https://$HOST/ (production assets rebuilt locally)"
CODE=000
for _ in $(seq 1 10); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/" || true)
  case "$CODE" in 2*|3*|401|403) break;; esac
  sleep 15
done
echo "   https://$HOST/ -> HTTP $CODE"

# f.
echo "f. Secrets are still unset. Run ./staging-secrets.sh in your own terminal."
