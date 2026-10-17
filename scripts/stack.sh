#!/usr/bin/env bash
# Starts and stops the local stack (mocks server and Worker): ./scripts/stack.sh <up|down>
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
state=.stack/state pids=.stack/pids logs=.stack/logs

WORKER_PORT=${WORKER_PORT:-8787}
MOCKS_PORT=${MOCKS_PORT:-8789}
STACK_READY_TIMEOUT=${STACK_READY_TIMEOUT:-180}
WORKER_URL=http://127.0.0.1:$WORKER_PORT
MOCKS_URL=http://127.0.0.1:$MOCKS_PORT
export WRANGLER_SEND_METRICS=false

down() {
  local file pid
  for file in "$pids"/*.pid; do
    [[ -f "$file" ]] || continue
    pid=$(<"$file")
    # Each process was started with setsid: its pid is its process group id.
    kill -TERM -- "-$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 -- "-$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -- "-$pid" 2>/dev/null || true
    rm -f "$file"
  done
}

port_taken() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

fail() {
  echo "stack: $1" >&2
  down
  exit 1
}

up() {
  down
  local port
  for port in "$WORKER_PORT" "$MOCKS_PORT"; do
    if port_taken "$port"; then fail "port $port is already taken"; fi
  done
  for dir in worker e2e; do
    [[ -d $dir/node_modules ]] || (cd "$dir" && npm ci)
  done
  rm -rf "$state"
  mkdir -p "$state" "$pids" "$logs"
  : >"$logs/worker.log"
  : >"$logs/mocks.log"

  (cd worker && npx wrangler d1 migrations apply DB --local --persist-to "$root/$state") >>"$logs/worker.log" 2>&1 ||
    fail "applying the D1 migrations failed, see $logs/worker.log"

  (
    cd e2e
    MOCKS_PORT=$MOCKS_PORT GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-yt-digest-local} \
      GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-local-google-secret} \
      setsid npx tsx mocks/server.ts >>"$root/$logs/mocks.log" 2>&1 &
    echo $! >"$root/$pids/mocks.pid"
  )

  local vars=(
    "PUBLIC_URL:${WORKER_URL%/}"
    "OPS_TOKEN:${OPS_TOKEN:-ops-local}"
    "LEASE_SECONDS:${LEASE_SECONDS:-600}"
    "ACCESS_TOKEN_TTL_SECONDS:${ACCESS_TOKEN_TTL_SECONDS:-3600}"
    "REFRESH_TOKEN_TTL_SECONDS:${REFRESH_TOKEN_TTL_SECONDS:-2592000}"
    "AUTH_CODE_TTL_SECONDS:${AUTH_CODE_TTL_SECONDS:-60}"
    "AUTH_REQUEST_TTL_SECONDS:${AUTH_REQUEST_TTL_SECONDS:-600}"
    "GOOGLE_ISSUER:${GOOGLE_ISSUER:-$MOCKS_URL/google}"
    "GOOGLE_CLIENT_ID:${GOOGLE_CLIENT_ID:-yt-digest-local}"
    "GOOGLE_CLIENT_SECRET:${GOOGLE_CLIENT_SECRET:-local-google-secret}"
    "ADMIN_EMAIL:${ADMIN_EMAIL:-alice@test}"
    "TOKEN_ENC_KEY:${TOKEN_ENC_KEY:-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=}"
    "ALLOWED_ORIGINS:${ALLOWED_ORIGINS:-}"
  )
  local args=()
  for var in "${vars[@]}"; do args+=(--var "$var"); done
  (
    cd worker
    setsid npx wrangler dev --local --ip 127.0.0.1 --port "$WORKER_PORT" --persist-to "$root/$state" \
      "${args[@]}" >>"$root/$logs/worker.log" 2>&1 &
    echo $! >"$root/$pids/worker.pid"
  )

  local deadline=$((SECONDS + STACK_READY_TIMEOUT))
  until curl -fsS -o /dev/null "$WORKER_URL/health" 2>/dev/null && curl -fsS -o /dev/null "$MOCKS_URL/health" 2>/dev/null; do
    if ((SECONDS >= deadline)); then fail "not ready after ${STACK_READY_TIMEOUT}s, see $logs/"; fi
    sleep 0.5
  done
  echo "stack: ready $WORKER_URL"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 <up|down>" >&2; exit 2 ;;
esac
