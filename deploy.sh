#!/usr/bin/env bash
set -euo pipefail

APP_NAME="omi-whatsapp"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[deploy] $*"; }

cd "$REPO_DIR"

log "Pulling latest code..."
git pull origin main

log "Installing dependencies..."
npm ci --omit=dev=false

log "Building..."
npm run build

log "Running tests..."
npm test

log "Reloading pm2 process..."
if pm2 list | grep -q "$APP_NAME"; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi

pm2 save

log "Deploy complete. Status:"
pm2 show "$APP_NAME"
