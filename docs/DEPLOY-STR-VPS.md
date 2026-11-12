# Little Flower on the STR company VPS (live since 12 Nov 2026)

How `docs/DEPLOY.md` was actually applied for https://littleflowerintschool.com, with the fixes found on the way. Use it as the checklist for the next school on a shared VPS. No secrets live in this file.

## Server

- Ubuntu 24.04, 1 vCPU, 3.8 GB RAM, 2 GB swap (already present), Nginx 1.24, Node 24, PM2 running as root and shared with other company sites.
- Little Flower adds about 500 MB of RAM (api ~170 MB, worker ~130 MB, web ~150 MB, plus PostgreSQL and Redis). About 2 GB stayed available after launch.
- A 1 GB VPS is too small for this stack: `next build` alone needs more than that.

## What is installed

| Part | Setup |
|---|---|
| PostgreSQL 18 (PGDG) | `/etc/postgresql/18/main/conf.d/littleflower.conf`: `listen_addresses = 'localhost'`, `max_connections = 30`, `shared_buffers = 128MB`, `effective_cache_size = 512MB`, `work_mem = 4MB`, `maintenance_work_mem = 64MB` |
| Redis 7.0 (Ubuntu package) | appended to `/etc/redis/redis.conf`: `bind 127.0.0.1 -::1`, `maxmemory 128mb`, `maxmemory-policy noeviction`, `requirepass` |
| Linux user | system user `littleflower`; `www-data` is in its group (Nginx reads uploads) |
| Secrets | `/root/littleflower-secrets.env` (root only, mode 600): DB, Redis, JWT, revalidate, session, super admin and demo passwords. `api/.env` and `web/.env` (mode 600, owned by littleflower) are built from it |
| Code | `/var/www/littleflower/api` (littleflower-back), `/var/www/littleflower/web` (littleflower-front), uploads in `/var/www/littleflower/uploads` |
| PM2 | `/var/www/littleflower/littleflower.config.cjs` (server-only wrapper, see below); apps `littleflower-api`, `littleflower-worker`, `littleflower-web` |
| Nginx | `/etc/nginx/sites-available/littleflowerintschool.com`, based on `docs/deploy/nginx-littleflower.conf`; reuses the existing Let's Encrypt certificate (apex + www) |

Postgres, Redis, the API (4020) and the web app (3000) listen on localhost only; only Nginx is public.

## Production .env values that differ from development

- api: `NODE_ENV=production`, absolute `UPLOAD_DIR`, local Redis URL, `DB_POOL_MAX=5`, `APP_URL=https://littleflowerintschool.com`, `SEED_DEMO=false`, new JWT secrets, a strong `SUPERADMIN_PASSWORD`, `SSLC_SANDBOX=true` until the live store keys arrive.
- web: `DATA_MODE=live`, `NEXT_PUBLIC_SITE_URL=https://littleflowerintschool.com`, `REVALIDATE_SECRET` equal to the API's, and its own `SESSION_SECRET` (never the same value as `REVALIDATE_SECRET`).
- `SUPERADMIN_PASSWORD` is only read by the first seed. Once the password is changed in the admin panel, the value in `.env` no longer works.

## Problems found and their fixes (already folded into DEPLOY.md and the nginx file)

1. **Leftover `umask 077`.** A config file written in that shell is unreadable by postgres. Run `umask 022` before installing packages or writing configs.
2. **`pm2 start ... --uid littleflower` fails.** PM2 passes the value as a string and fails with `options.uid must be int32`; a number on the command line fails the same way. Put the numeric uid and gid in a config file instead.
3. **PM2 ignores a config file whose name does not end in `.config.cjs`.** It runs it as a plain script that does nothing. Name the wrapper `littleflower.config.cjs`.
4. **`http2 on;` fails `nginx -t` on Nginx 1.24.** Use `listen 443 ssl http2;`.
5. **https://www fell through to the VPS default site.** Add a separate 443 server for `www.` that returns 301 to the apex.
6. **`npm run check` reports the queue as failed before the worker runs.** This is expected; run it again after `pm2 start`.

### PM2 wrapper (create once per server)

```bash
cat > /var/www/littleflower/littleflower.config.cjs <<EOF
// Server-only: runs the repo's PM2 apps as the littleflower user.
const base = require("/var/www/littleflower/api/ecosystem.config.cjs");
module.exports = { apps: base.apps.map((app) => ({ ...app, uid: $(id -u littleflower), gid: $(id -g littleflower) })) };
EOF
pm2 start /var/www/littleflower/littleflower.config.cjs
pm2 save
```

## Update a release

```bash
cd /var/www/littleflower/api && sudo -u littleflower -H sh -c 'git pull && npm ci --omit=dev && npx prisma migrate deploy' \
  && pm2 reload littleflower-api littleflower-worker
cd /var/www/littleflower/web && sudo -u littleflower -H sh -c 'git pull && npm ci && npm run build' \
  && pm2 reload littleflower-web
```

Build at a quiet hour: on 1 vCPU, `next build` takes 3 to 5 minutes and slows the other sites.

## Demo data for the client walkthrough (temporary)

The demo seed is blocked in production. For the client presentation it is loaded once on purpose, after a clean snapshot, and removed later by restoring that snapshot.

**Load:**

```bash
# 1. clean snapshot, kept outside the rotated daily folder
sudo -u littleflower /var/www/littleflower/api/scripts/ops/backup.sh
mkdir -p /var/backups/littleflower/before-demo
cp -a "$(ls -d /var/backups/littleflower/daily/littleflower_* | tail -1)" /var/backups/littleflower/before-demo/
chown -R littleflower:littleflower /var/backups/littleflower/before-demo

# 2. demo password (all demo logins share it)
grep -q '^DEMO_PASS=' /root/littleflower-secrets.env || echo "DEMO_PASS=$(openssl rand -base64 12 | tr -d '/+=')" >> /root/littleflower-secrets.env
source /root/littleflower-secrets.env

# 3. demo seed: development mode for this one command only
cd /var/www/littleflower/api
sudo -u littleflower -H env NODE_ENV=development SEED_DEMO=true SEED_DEMO_PASSWORD="$DEMO_PASS" node prisma/seed.js
```

Demo logins: `admin@littleflower.demo`, `office@littleflower.demo`, `accounts@littleflower.demo`, `teacher@littleflower.demo` (password = `DEMO_PASS`). The demo seed skips itself when students already exist.

**Remove (after the walkthrough, before real data entry):**

```bash
ls /var/backups/littleflower/before-demo/
/var/www/littleflower/api/scripts/ops/restore.sh /var/backups/littleflower/before-demo/littleflower_<stamp>
cd /var/www/littleflower/web && sudo -u littleflower -H npm run build && pm2 reload littleflower-web
```

- Run `restore.sh` as **root** on this server: the PM2 daemon belongs to root, so `pm2 stop` and `pm2 start` inside the script only work from root.
- The restore brings back the database and uploads exactly as they were before the demo. Anything entered after the snapshot (website edits, uploads) is lost, so remove the demo before the school starts real work.

## Still open

- Backups: monthly off-server copy after the client pays (`RCLONE_REMOTE` in `/etc/littleflower/backup.env`, plus cron).
- From the school: SMS key and sender id, live SSLCommerz store, school mailbox for `CONTACT_TO`.
