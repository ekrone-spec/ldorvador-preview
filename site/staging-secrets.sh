#!/usr/bin/env bash
# Sets Worker secrets. Values are read silently and never echoed or stored.
# Usage: ./staging-secrets.sh [--prod]
set -euo pipefail
cd "$(dirname "$0")"
ENVFLAG=(--env staging); TARGET=staging
if [ "${1:-}" = "--prod" ]; then
  read -rp "This writes to PRODUCTION secrets. Type 'production' to continue: " c
  [ "$c" = "production" ] || { echo "Aborted."; exit 1; }
  ENVFLAG=(); TARGET=production
fi
ask() { # NAME description
  local v; read -rsp "$1 ($2): " v; echo
  [ -n "$v" ] || { echo "Empty value, aborting." >&2; exit 1; }
  printf '%s' "$v" | npx wrangler secret put "$1" ${ENVFLAG[@]+"${ENVFLAG[@]}"} >/dev/null
  echo "  set $1"
}
ask STRIPE_SECRET_KEY "Stripe dashboard > Developers > API keys, restricted key (TEST mode for staging)"
ask STRIPE_WEBHOOK_SECRET "Stripe > Developers > Webhooks > your endpoint > Signing secret (whsec_...)"
ask TURNSTILE_SECRET "Cloudflare > Turnstile > the site widget > Secret key"
ask RESEND_API_KEY "Resend dashboard > API Keys"
openssl rand -base64 48 | npx wrangler secret put BOOKING_TOKEN_SECRET ${ENVFLAG[@]+"${ENVFLAG[@]}"} >/dev/null
echo "  set BOOKING_TOKEN_SECRET (generated)"
if [ "$TARGET" = staging ]; then
  echo "Staging: https://staging.ldorvadortravel.com/"
  echo "Admin:   https://staging.ldorvadortravel.com/admin"
else
  echo "Production: https://ldorvadortravel.com/"
  echo "Admin:      https://ldorvadortravel.com/admin"
fi
