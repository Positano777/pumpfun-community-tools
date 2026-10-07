#!/usr/bin/env bash
# ============================================================================
# One-time Cloudflare setup for RugHawk. Safe to re-run.
#
# Already provisioned through the Cloudflare connector on 2026-10-07 (ids are
# in wrangler.jsonc): D1 rughawk-db (schema applied), KV rughawk-cache,
# R2 rughawk-reports / rughawk-rag-content / rughawk-next-cache.
#
# This script does the parts that need wrangler or a dashboard click:
#   1. Vectorize index for Scam DNA
#   2. D1 schema (idempotent re-apply)
#   3. Worker secrets
#   4. Deploy
#   5. AI Search instance + Hawk Playbook upload (via /api/admin/setup)
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

WRANGLER="npx wrangler"
step() { printf '\n\033[1;31m== %s ==\033[0m\n' "$*"; }

step "0/5 Auth check"
$WRANGLER whoami | grep -Eq "logged in|Account" || { echo "Run: npx wrangler login"; exit 1; }

step "1/5 Vectorize index (768-dim bge-base-en-v1.5, cosine)"
$WRANGLER vectorize create rughawk-dna --dimensions=768 --metric=cosine 2>&1 | grep -Ev '^\s*$' || true
$WRANGLER vectorize create-metadata-index rughawk-dna --property-name=grade --type=string 2>/dev/null || true

step "2/5 D1 schema"
$WRANGLER d1 execute rughawk-db --remote --file=migrations/0001_init.sql

step "3/5 Secrets (skipped when already set)"
EXISTING="$($WRANGLER secret list 2>/dev/null || echo '[]')"
for name in QUICKNODE_RPC_URL ADMIN_TOKEN CRON_SECRET; do
  if grep -q "\"$name\"" <<<"$EXISTING"; then
    echo "secret exists: $name"
  elif [ "$name" = "QUICKNODE_RPC_URL" ]; then
    echo "Paste the RugHawk QuickNode endpoint URL (QuickNode endpoint 672448):"
    $WRANGLER secret put QUICKNODE_RPC_URL
  else
    openssl rand -hex 24 | $WRANGLER secret put "$name" >/dev/null && echo "generated: $name"
  fi
done

step "4/5 Build + deploy"
npm run deploy

step "5/5 AI Search knowledge base"
URL="${RUGHAWK_URL:-}"
if [ -z "$URL" ]; then
  echo "Set RUGHAWK_URL (e.g. https://rughawk.<subdomain>.workers.dev) and ADMIN_TOKEN, then run:"
  echo '  curl -X POST "$RUGHAWK_URL/api/admin/setup" -H "Authorization: Bearer $ADMIN_TOKEN"'
else
  curl -fsS -X POST "$URL/api/admin/setup" -H "Authorization: Bearer ${ADMIN_TOKEN:?set ADMIN_TOKEN}" && echo
fi

printf '\n\033[1;32mDone.\033[0m Optional dashboard steps: create AI Gateway "rughawk-ai" (logs, caching, spend limit, Guardrails incl. Prompt Injection) and set AI_GATEWAY_ID to it.\n'
