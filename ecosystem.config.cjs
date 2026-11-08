/**
 * PM2 apps for one Greendale school on the VPS (pm2 start ecosystem.config.cjs; pm2 save).
 * Paths follow docs/DEPLOY.md. API and worker run src/*.js directly (no build step);
 * the web app runs `next start` bound to 127.0.0.1 behind Nginx.
 */
const ROOT = process.env.GREENDALE_ROOT || "/var/www/greendale";

module.exports = {
    apps: [
        {
            name: "greendale-api",
            cwd: `${ROOT}/api`,
            script: "src/server.js",
            node_args: "--enable-source-maps",
            env: { NODE_ENV: "production" },
            max_memory_restart: "400M",
            kill_timeout: 15000,
            time: true,
        },
        {
            name: "greendale-worker",
            cwd: `${ROOT}/api`,
            script: "src/worker.js",
            env: { NODE_ENV: "production" },
            max_memory_restart: "350M",
            kill_timeout: 35000, // the worker finishes active jobs (30 s) before exiting
            time: true,
        },
        {
            name: "greendale-web",
            cwd: `${ROOT}/web`,
            script: "node_modules/next/dist/bin/next",
            args: "start -p 3000 -H 127.0.0.1",
            env: { NODE_ENV: "production" },
            max_memory_restart: "600M",
            time: true,
        },
    ],
};
