#!/usr/bin/env bash
# Container entrypoint.   start.sh all | web | ai
#   all  the Hugging Face Space: billing + public web tier (Node) and the AI service (Python) in one container
#   web  billing + public web tier only        (docker-compose service "web")
#   ai   the AI service only                   (docker-compose service "ai")
# Anything you set in the environment wins; secrets that are not set are generated for this run.
set -euo pipefail
mode="${1:-all}"

random_hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

export SESSION_SECRET="${SESSION_SECRET:-$(random_hex 32)}"     # sessions end when the container restarts
export AI_SERVICE_TOKEN="${AI_SERVICE_TOKEN:-$(random_hex 24)}" # shared by the web tier and the AI service
export BILLING_DB_PATH="${BILLING_DB_PATH:-/tmp/billing.db}"
export ENABLE_QA_RUNS="${ENABLE_QA_RUNS:-0}"                    # browser tests need Playwright; local only
# A Hugging Face Space is served over https, so the session cookie can (and should) be Secure.
if [ -n "${SPACE_ID:-}" ]; then export COOKIE_SECURE=1; fi

ai_port="${AI_PORT:-8100}"

pids=()
stop() { kill "${pids[@]}" 2>/dev/null || true; }
trap stop TERM INT

start_ai() {
  if [ "${ACTIVE_PROVIDER:-ollama}" = "ollama" ]; then
    echo "WARNING: ACTIVE_PROVIDER is not set, so the Copilot has no LLM here (Ollama is not in this image)." >&2
    echo "         Set ACTIVE_PROVIDER (groq | openai | anthropic | cloudflare) and that provider's API key." >&2
  fi
  local host="127.0.0.1"; [ "$mode" = "ai" ] && host="0.0.0.0"
  BILLING_API_URL="${BILLING_API_URL:-http://127.0.0.1:8000}" \
    python -m uvicorn ai_service.main:app --host "$host" --port "$ai_port" --log-level warning &
  pids+=($!)
}

start_web() {
  if [ ! -f "$BILLING_DB_PATH" ]; then (cd services/billing && node dist/seed.js); fi
  (
    cd services/billing
    NODE_ENV=production HOST="${HOST:-0.0.0.0}" PORT="${PORT:-7860}" WEB_DIST="${WEB_DIST:-/app/web/dist}" \
      AI_SERVICE_URL="${AI_SERVICE_URL:-http://127.0.0.1:$ai_port}" exec node dist/server.js
  ) &
  pids+=($!)
}

case "$mode" in
  all) start_ai; start_web ;;
  web) start_web ;;
  ai)  start_ai ;;
  *)   echo "usage: start.sh all|web|ai" >&2; exit 2 ;;
esac

# If either process ends, the container ends (and gets restarted), rather than half-working.
wait -n
status=$?
stop
exit "$status"
