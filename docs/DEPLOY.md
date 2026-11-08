# Little Flower: VPS deployment and operations

Audience: the person (or Gemini) deploying one school on the STR VPS. Follow the sections in order the
first time; later releases only need "Update a release". Commands assume Ubuntu 24.04 and sudo.

Layout used everywhere (scripts, PM2, Nginx):

```
/var/www/littleflower/
  api/        littleflower-back (Express API + worker)        → 127.0.0.1:4020
  web/        littleflower-front (Next.js, DATA_MODE=live)    → 127.0.0.1:3000
  uploads/    public/ private/ tmp/   (outside both code folders, owned by littleflower)
/var/backups/littleflower/{daily,weekly}
/var/log/littleflower/
```

**Sharing a VPS with another school (e.g. Greendale on the STR VPS):** ports, Linux user, database, Redis prefix and folders must all differ. The API already uses 4020 (Greendale 4000). Change the web port from 3000 to a free one (e.g. 3020) in three places: `ecosystem.config.cjs` (`start -p 3020`), `docs/deploy/nginx-littleflower.conf` (`littleflower_web` upstream) and `WEB_INTERNAL_URL` in api/.env. `APP_SLUG=littleflower` keeps Redis keys and cookies apart.

## 1. Server packages (once per VPS)

1. Swap 2 GB (the VPS has none): `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab`
2. PostgreSQL 18 from the PGDG repository (`apt install postgresql-18`). Server timezone may stay UTC: the API computes school dates in Asia/Dhaka.
3. Redis ≥ 7 (`apt install redis-server`). In `/etc/redis/redis.conf`: `bind 127.0.0.1 -::1`, `maxmemory 128mb`, `maxmemory-policy noeviction`, `requirepass <long random>`. `systemctl restart redis-server`.
4. Node 24 (already on the VPS) and PM2 (already installed). Nginx 1.24 (already installed), certbot (`apt install certbot python3-certbot-nginx`).
5. Firewall: `ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable`. Ports 3000, 4020, 5432 and 6379 must NOT be public; all four bind to 127.0.0.1. (The other STR apps listen on `*`: check them before enabling ufw.)

## 2. Accounts, database, folders

```bash
adduser --system --group --home /var/www/littleflower littleflower
mkdir -p /var/www/littleflower/{api,web,uploads/{public,private,tmp}} /var/backups/littleflower /var/log/littleflower
chown -R littleflower:littleflower /var/www/littleflower /var/backups/littleflower /var/log/littleflower
chmod 750 /var/www/littleflower/uploads/private /var/backups/littleflower
sudo -u postgres psql -c "CREATE USER littleflower WITH PASSWORD '<db password>';" -c "CREATE DATABASE littleflower OWNER littleflower;"
```

Nginx (www-data) must read `uploads/public` and `uploads/private` (for X-Accel-Redirect): `usermod -aG littleflower www-data` and keep group read on uploads (`chmod -R g+rX /var/www/littleflower/uploads`).

## 3. Code and environment

Clone `littleflower-back` into `api/` and `littleflower-front` into `web/` (as littleflower). Then:

**api/.env** (copy `.env.example`):

| Key | Production value |
|---|---|
| NODE_ENV | production |
| HOST / PORT | 127.0.0.1 / 4020 |
| DATABASE_URL | postgresql://littleflower:<db password>@localhost:5432/littleflower?schema=public |
| REDIS_URL | redis://default:<redis password>@127.0.0.1:6379 |
| APP_SLUG | littleflower (cookie names, JWT issuer, Redis names; must equal web config/school.js slug) |
| QUEUE_PREFIX | empty (defaults to APP_SLUG; one prefix per school on a shared Redis) |
| JWT_ACCESS_SECRET, JWT_REFRESH_SECRET | two different 64-byte random values |
| APP_URL | https://school.example.com (public; the payment gateway callbacks are built from it) |
| WEB_INTERNAL_URL | http://127.0.0.1:3000 |
| REVALIDATE_SECRET | 32+ random chars, the same value in web/.env |
| UPLOAD_DIR | /var/www/littleflower/uploads |
| SMTP_* / MAIL_FROM / CONTACT_TO | school mailbox (app password) |
| SMS_PROVIDER / SMS_API_KEY / SMS_SENDER_ID | bulksmsbd + the client's key and approved sender id (empty provider = SMS only logged) |
| SSLC_STORE_ID / SSLC_STORE_PASS / SSLC_SANDBOX | live store from the client; SSLC_SANDBOX=false only at launch |
| SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD | first Super Admin (created once by the seed) |
| SEED_DEMO | false (the demo seed is blocked in production anyway) |

**web/.env**: `DATA_MODE=live`, `API_INTERNAL_URL=http://127.0.0.1:4020`, `REVALIDATE_SECRET=<same as api>`, `NODE_ENV=production`.
School branding (name, logo files, colours) lives in `web/config/school.js` and `web/public/images/`; the rest of the school setup is data (Settings screen).

`chmod 600 api/.env web/.env`.

## 4. First start (order matters)

```bash
cd /var/www/littleflower/api
npm ci --omit=dev
npx prisma migrate deploy          # never migrate dev / reset / db push on the server
npm run db:seed                    # bootstrap + website content only; idempotent, never overwrites edits
npm run check                      # DB, Redis, queue round trip
pm2 start ecosystem.config.cjs --only littleflower-api,littleflower-worker

cd /var/www/littleflower/web
npm ci
npm run build                      # the API must be running: public pages are prerendered from it
pm2 start /var/www/littleflower/api/ecosystem.config.cjs --only littleflower-web
pm2 save && pm2 startup            # survive reboots
```

Nginx: copy `docs/deploy/nginx-littleflower.conf` to `/etc/nginx/sites-available/littleflower`, set the domain, enable it, `nginx -t && systemctl reload nginx`, then `certbot --nginx -d school.example.com`.

## 5. Cron (as littleflower, `crontab -e`; times are server time, set `CRON_TZ=Asia/Dhaka` on the first line)

```
CRON_TZ=Asia/Dhaka
0 3 * * *  /var/www/littleflower/api/scripts/ops/backup.sh >> /var/log/littleflower/backup.log 2>&1
```

Weekly restore test, same crontab (once before: `sudo -u postgres psql -c "ALTER ROLE littleflower CREATEDB"`, it creates and drops a scratch database):

```
0 4 * * 0  /var/www/littleflower/api/scripts/ops/verify-restore.sh >> /var/log/littleflower/restore-test.log 2>&1
```

The worker schedules its own jobs (no cron needed): monthly invoices at 06:10 on the day set in Settings, nightly maintenance at 03:30 (orphan uploads, stale online checkouts, old login tokens).

Offsite copy (strongly recommended, the VPS is a single machine): `apt install rclone`, `rclone config` (e.g. Google Drive of the school), then `RCLONE_REMOTE=gdrive:littleflower-backups` in `/etc/littleflower/backup.env`.

## 6. Launch checklist

1. Settings screen: school profile, weekly holidays, absent SMS time, receipt prefix, admit card hold, modules.
2. Classes, sections, subjects, staff and teacher logins; class and subject teachers.
3. Fee structure, then Students → Import CSV (download the portal logins file and hand it to the office).
4. Fees → Generate invoices for the current month (or set the automatic day).
5. SMS: send one test to an office number; check the balance shows.
6. Online payment: one real small payment with the live store, check the receipt appears and the IPN line in the API log.
7. One full exam cycle on real data: setup → open → teachers enter marks → lock → publish → guardian portal.
8. `backup.sh` once by hand, then `verify-restore.sh` must print RESTORE TEST PASSED.
9. `pm2 logs` quiet for a day; `npm run uploads:cleanup -- --dry` shows nothing unexpected.

## 7. Update a release

```bash
cd /var/www/littleflower/api && git pull && npm ci --omit=dev && npx prisma migrate deploy && pm2 reload littleflower-api littleflower-worker
cd /var/www/littleflower/web && git pull && npm ci && npm run build && pm2 reload littleflower-web
```

Take a backup first when the release has a migration (`scripts/ops/backup.sh`). `prisma migrate deploy` only applies new migrations; it never drops data on its own.

## 8. Restore (disaster or bad release)

```bash
sudo -u littleflower /var/www/littleflower/api/scripts/ops/restore.sh /var/backups/littleflower/daily/littleflower_<stamp>
```

It verifies checksums, asks you to type RESTORE, stops PM2, restores the database and uploads (the old uploads folder is moved aside, not deleted), runs `prisma migrate deploy` and starts PM2 again. `--db-only` / `--uploads-only` restore one part. `TARGET_DATABASE_URL=... restore.sh <dir> --db-only` restores into another database for inspection without touching the live site.

## 9. Health and logs

- `curl -s https://school.example.com/api/health` → db and redis "ok".
- `pm2 logs littleflower-api --lines 200` (JSON lines; payment and gateway lines carry the tran id).
- Audit log screen in the admin for who changed what.
- `npm test` (unit) runs anywhere; `npm run test:api` writes data and is for development databases only (refuses NODE_ENV=production).
