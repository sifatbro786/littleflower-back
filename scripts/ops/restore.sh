#!/usr/bin/env bash
# Restore a Little Flower backup. DESTRUCTIVE for the target database: it is replaced by the backup.
#
#   scripts/ops/restore.sh /var/backups/littleflower/daily/littleflower_2026-11-07_0300 [--db-only|--uploads-only]
#
# Steps: checks SHA256SUMS → asks for confirmation → stops the API and worker (PM2) → restores the
# database with --clean --if-exists → restores uploads (current folder moved aside, not deleted) →
# prisma migrate deploy (a backup older than the code gets the newer migrations) → starts PM2 again.
# Set TARGET_DATABASE_URL to restore into another database instead of the live one (PM2 untouched).
set -euo pipefail
SRC="${1:?usage: restore.sh <backup folder> [--db-only|--uploads-only]}"
MODE="${2:-all}"
APP_DIR="${APP_DIR:-/var/www/littleflower/api}"
env_value() { grep -E "^$1=" "$APP_DIR/.env" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
UPLOAD_DIR="${UPLOAD_DIR:-$(env_value UPLOAD_DIR)}"; UPLOAD_DIR="${UPLOAD_DIR:-/var/www/littleflower/uploads}"
case "$UPLOAD_DIR" in /*) ;; *) UPLOAD_DIR="$APP_DIR/$UPLOAD_DIR" ;; esac
TARGET="${TARGET_DATABASE_URL:-$(env_value DATABASE_URL)}"
PG_URL="${TARGET%%\?*}"
LIVE=1; [ -n "${TARGET_DATABASE_URL:-}" ] && LIVE=0

( cd "$SRC" && sha256sum --check --quiet SHA256SUMS ) || { echo "checksum mismatch: backup is damaged" >&2; exit 1; }
echo "Restore $SRC ($MODE) into $(echo "$PG_URL" | sed -E 's#//[^@]+@#//***@#')"
read -r -p "Type RESTORE to continue: " ok; [ "$ok" = "RESTORE" ] || { echo "cancelled"; exit 1; }

[ "$LIVE" = 1 ] && pm2 stop littleflower-api littleflower-worker || true
if [ "$MODE" != "--uploads-only" ]; then
    pg_restore --dbname="$PG_URL" --clean --if-exists --no-owner --no-privileges --single-transaction "$SRC/db.dump"
    echo "database restored"
fi
if [ "$MODE" != "--db-only" ] && [ "$LIVE" = 1 ]; then
    if [ -d "$UPLOAD_DIR" ]; then mv "$UPLOAD_DIR" "${UPLOAD_DIR}.before-restore-$(date +%s)"; fi
    tar -C "$(dirname "$UPLOAD_DIR")" -xzf "$SRC/uploads.tar.gz"
    echo "uploads restored (old folder kept as ${UPLOAD_DIR}.before-restore-*)"
fi
if [ "$LIVE" = 1 ]; then
    ( cd "$APP_DIR" && npx prisma migrate deploy )
    pm2 start littleflower-api littleflower-worker
fi
echo "restore done"
