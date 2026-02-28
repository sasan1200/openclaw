#!/bin/bash
# rebuilds OpenClaw stack with strict preflight checks
set -eo pipefail

# Config
REPO_DIR="/Users/franco/.openclaw/workspace/projects/openclaw"
COMPOSE_FILES=(
  "docker-compose.yml"
  "docker-compose.override.yml"
)
SCRIPT_LOG="/tmp/openclaw-rebuild-$(date +%s).log"

# Preflight checks
echo "🔎 Preflight checks..." | tee -a "$SCRIPT_LOG"
command -v docker >/dev/null 2>&1 || { echo >&2 "Missing docker"; exit 1; }
command -v git >/dev/null 2>&1 || { echo >&2 "Missing git"; exit 1; }

cd "$REPO_DIR"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "s-sandbox-2" ]]; then
  echo "⚠️ Wrong branch: $CURRENT_BRANCH" | tee -a "$SCRIPT_LOG"
  read -p "Continue? [y/N] " -n 1 -r
  [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

# Build compose command prefix
COMPOSE_CMD="docker compose"
for file in "${COMPOSE_FILES[@]}"; do
    COMPOSE_CMD+=" -f $file"
done

# Execution flow
echo "🗑️ Tearing down..." | tee -a "$SCRIPT_LOG"
timeout 60 docker compose -f "${COMPOSE_FILES[@]}" down --remove-orphans --volumes >> "$SCRIPT_LOG" 2>&1 || true

echo "🔨 Rebuilding..." | tee -a "$SCRIPT_LOG"
docker compose "${compose_args[@]}" build --no-cache >> "$SCRIPT_LOG" 2>&1

echo "🚀 Starting..." | tee -a "$SCRIPT_LOG"
docker compose "${compose_args[@]}" up -d >> "$SCRIPT_LOG" 2>&1

echo "🏥 Doctor..." | tee -a "$SCRIPT_LOG"
docker compose -f "${COMPOSE_FILES[@]}" exec -T openclaw-cli node dist/index.js doctor --fix >> "$SCRIPT_LOG" 2>&1

echo "✅ Done! Log: $SCRIPT_LOG"
docker compose -f "${COMPOSE_FILES[@]}" exec -T openclaw-cli node dist/index.js gateway status
