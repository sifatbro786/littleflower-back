#!/usr/bin/env bash
# Little Flower daily backup: PostgreSQL (custom format) + uploads, with rotation and an optional offsite copy.
#
#   sudo -u littleflower /var/www/littleflower/api/scripts/ops/backup.sh
#   cron (03:00 Asia/Dhaka, before the 03:30 maintenance job):
#   0 3 * * * /var/www/littleflower/api/scripts/ops/backup.sh >> /var/log/littleflower/backup.log 2>&1
#
# Settings (environment or /etc/littleflower/backup.env):
#   APP_DIR      API folder with .env            (default /var/www/littleflower/api)
#   UPLOAD_DIR   uploads root                    (default from .env, else /var/www/littleflower/uploads)
#   BACKUP_DIR   where archives go               (default /var/backups/littleflower)
#   KEEP_DAILY   daily archives to keep          (default 14)
#   KEEP_WEEKLY  Sunday archives to keep         (default 8)
#   RCLONE_REMOTE  e.g. "gdrive:littleflower-backups" (optional; needs rclone configured)
set -euo pipefail
umask 077

[ -f /etc/littleflower/backup.env ] && . /etc/littleflower/backup.env
APP_DIR="${APP_DIR:-/var/www/littleflower/api}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/littleflower}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"

env_value() { grep -E "^$1=" "$APP_DIR/.env" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
DATABASE_URL="${DATABASE_URL:-$(env_value DATABASE_URL)}"
UPLOAD_DIR="${UPLOAD_DIR:-$(env_value UPLOAD_DIR)}"
UPLOAD_DIR="${UPLOAD_DIR:-/var/www/littleflower/uploads}"
case "$UPLOAD_DIR" in /*) ;; *) UPLOAD_DIR="$APP_DIR/$UPLOAD_DIR" ;; esac
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL not found in $APP_DIR/.env" >&2; exit 1; }
PG_URL="${DATABASE_URL%%\?*}" # pg_dump rejects Prisma's ?schema=public

STAMP="$(TZ=Asia/Dhaka date +%Y-%m-%d_%H%M)"
DAY="$(TZ=Asia/Dhaka date +%u)" # 7 = Sunday
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"
OUT="$BACKUP_DIR/daily/littleflower_$STAMP"
mkdir -p "$OUT"

echo "[$(date -Is)] backup start → $OUT"
pg_dump --dbname="$PG_URL" --format=custom --compress=6 --no-owner --no-privileges --file="$OUT/db.dump"
pg_restore --list "$OUT/db.dump" > /dev/null # the dump must be readable, else fail loudly
tar -C "$(dirname "$UPLOAD_DIR")" -czf "$OUT/uploads.tar.gz" --exclude="$(basename "$UPLOAD_DIR")/tmp" "$(basename "$UPLOAD_DIR")"
( cd "$OUT" && sha256sum db.dump uploads.tar.gz > SHA256SUMS )
echo "db $(du -h "$OUT/db.dump" | cut -f1), uploads $(du -h "$OUT/uploads.tar.gz" | cut -f1)"

if [ "$DAY" = "7" ]; then cp -al "$OUT" "$BACKUP_DIR/weekly/" 2>/dev/null || cp -a "$OUT" "$BACKUP_DIR/weekly/"; fi

# Rotation: newest N kept
rotate() { find "$1" -mindepth 1 -maxdepth 1 -type d -name 'littleflower_*' | sort | head -n -"$2" | xargs -r rm -rf; }
rotate "$BACKUP_DIR/daily" "$KEEP_DAILY"
rotate "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"

if [ -n "${RCLONE_REMOTE:-}" ]; then
    rclone copy "$OUT" "$RCLONE_REMOTE/daily/$(basename "$OUT")" --quiet && echo "offsite copy ok ($RCLONE_REMOTE)"
fi
echo "[$(date -Is)] backup done"
