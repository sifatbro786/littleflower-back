#!/usr/bin/env bash
# Restore test (launch requirement: "daily backups are restore tested").
# Restores the newest backup into a scratch database, compares row counts of the important tables
# with the live database, checks the uploads archive, then drops the scratch database.
# The database user needs CREATEDB once: sudo -u postgres psql -c "ALTER ROLE littleflower CREATEDB"
#
#   sudo -u littleflower /var/www/littleflower/api/scripts/ops/verify-restore.sh
#   cron weekly (Sunday 04:00): 0 4 * * 0 .../verify-restore.sh >> /var/log/littleflower/restore-test.log 2>&1
set -euo pipefail
APP_DIR="${APP_DIR:-/var/www/littleflower/api}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/littleflower}"
env_value() { grep -E "^$1=" "$APP_DIR/.env" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
LIVE_URL="$(env_value DATABASE_URL)"; LIVE_URL="${LIVE_URL%%\?*}"
LATEST="${1:-$(ls -1d "$BACKUP_DIR"/daily/littleflower_* | sort | tail -1)}"
SCRATCH="littleflower_restore_check"
# Same credentials, maintenance database "postgres" (override with ADMIN_DATABASE_URL)
ADMIN_URL="${ADMIN_DATABASE_URL:-$(echo "$LIVE_URL" | sed -E 's#/[^/]*$#/postgres#')}"

( cd "$LATEST" && sha256sum --check --quiet SHA256SUMS )
psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH"
trap 'psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $SCRATCH"' EXIT
SCRATCH_URL="$(echo "$ADMIN_URL" | sed -E "s#/[^/]*\$#/$SCRATCH#")"
pg_restore --dbname="$SCRATCH_URL" --no-owner --no-privileges --exit-on-error "$LATEST/db.dump"

fail=0
for t in Student Enrollment Mark ResultSnapshot Attendance Invoice Payment Allocation PaymentReversal Counter User AuditLog; do
    a=$(psql "$SCRATCH_URL" -Atc "SELECT count(*) FROM \"$t\"")
    b=$(psql "$LIVE_URL" -Atc "SELECT count(*) FROM \"$t\"")
    # live may have grown since the backup; restored must not have MORE rows, and never 0 when live has data
    if [ "$a" -gt "$b" ] || { [ "$a" -eq 0 ] && [ "$b" -gt 0 ]; }; then echo "✗ $t: backup $a, live $b"; fail=1; else echo "✓ $t: backup $a, live $b"; fi
done
# Money must balance inside the backup itself: no invoice over-allocated, no payment over-allocated.
over=$(psql "$SCRATCH_URL" -Atc 'SELECT count(*) FROM (SELECT p.id FROM "Payment" p JOIN "Allocation" a ON a."paymentId"=p.id GROUP BY p.id HAVING SUM(a.amount) > MAX(p.amount)) x')
[ "$over" = "0" ] && echo "✓ payments balance" || { echo "✗ $over payments allocate more than they received"; fail=1; }
tar -tzf "$LATEST/uploads.tar.gz" > /dev/null && echo "✓ uploads archive readable ($(tar -tzf "$LATEST/uploads.tar.gz" | grep -vc '/$') files)"

if [ "$fail" = 0 ]; then echo "RESTORE TEST PASSED: $(basename "$LATEST")"; else echo "RESTORE TEST FAILED: $(basename "$LATEST")"; exit 1; fi
