# Restaurant Project Deployment Guide

This app can run on Render Free for demos, but production must use persistent storage because it stores SQLite data, uploads, logs, and backups on disk.

## Hosting Options

- `Render`
  Good if you want easier managed security, GitHub auto deploy, and less server maintenance.
  Free is fine for demos. Production should use a paid web service with a persistent disk and a single instance only.

- `VPS`
  Good if you want full control and traditional server management.

## Recommended Setup

- Render web service
- Node.js 20 or newer
- Render Free for demo, or persistent disk enabled for production
- One running instance only while using SQLite
- Environment variables configured in the Render dashboard

## Render Deployment

This repository now includes:

- `render.yaml`

For the current free demo blueprint, use:

- `Web Service`
- `Free plan`
- `1 instance only`
- `No persistent disk`

Important: free demo data can reset after restart or redeploy.

For production, upgrade to a paid plan and add a persistent disk.

### Important Render settings

- Build command:

```bash
npm install --omit=dev
```

For Render Blueprint, the repository uses the lockfile-based command:

```bash
npm ci --omit=dev
```

- Start command:

```bash
npm start
```

- Environment variables:

```env
NODE_ENV=production
NODE_VERSION=20
PORT=10000
STORAGE_ROOT=/tmp/restaurant-demo-storage
PAYSTACK_PUBLIC_KEY=...
PAYSTACK_SECRET_KEY=...
ADMIN_USERNAME=...
ADMIN_PASSWORD_HASH=...
STAFF_USERNAME=staff
STAFF_DISPLAY_NAME=Staff
STAFF_PASSWORD_HASH=...
BACKUP_HOUR=3
BACKUP_RETENTION_DAYS=14
```

For production with a persistent disk, change `STORAGE_ROOT` to:

```env
STORAGE_ROOT=/opt/render/project/src/storage
```

### Why `STORAGE_ROOT` matters

All writable app files now live under one storage path:

- database
- uploads
- backups
- logs

On Render Free, this path is temporary. On paid Render with a disk, only files written inside the disk mount path persist across deploys and restarts.

### Render mount path

For production with a persistent disk, use this mount path:

```text
/opt/render/project/src/storage
```

### Render notes

- uploaded images are still served from `/images/uploads/...`
- the real files are stored under `STORAGE_ROOT`
- keep only one instance because SQLite should not be shared across multiple app instances

## 1. Upload the project

Copy the whole project folder to your server, then install dependencies:

```bash
npm install --omit=dev
```

## 2. Configure environment variables

Create a `.env` file from `.env.example` and set:

- `PAYSTACK_PUBLIC_KEY`
- `PAYSTACK_SECRET_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`
- `STAFF_USERNAME`
- `STAFF_DISPLAY_NAME`
- `STAFF_PASSWORD_HASH`
- `PORT=3000`
- `BACKUP_HOUR`
- `BACKUP_RETENTION_DAYS`

Generate password hashes with:

```bash
npm run hash-password
```

Use live Paystack keys before launch. Do not use test keys in production.

## 3. Validate before launch

Run:

```bash
npm run check
npm run check-db
node server.js
```

Open:

- `http://SERVER_IP:3000/`
- `http://SERVER_IP:3000/healthz`

Stop the server after testing.

## 4. Run with PM2

Install PM2 globally:

```bash
npm install -g pm2
```

Start the app:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Useful PM2 commands:

```bash
pm2 status
pm2 logs restaurant-project
pm2 restart restaurant-project
```

Useful database safety commands:

```bash
npm run backup-db
npm run check-db
```

## 5. Put Nginx in front

Example Nginx config:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Connection "";
        proxy_buffering on;
        gzip on;
        gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
    }
}
```

After that, add SSL with Certbot:

```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

## 6. Optional SSH deploy workflow

This repository already includes:

- `.github/workflows/deploy.yml`

The workflow is manual-only and is for VPS/SSH deployments. Render does not need it because Render deploys directly from your GitHub repository.

### GitHub repository secrets

In your GitHub repository, add these Actions secrets:

- `SSH_HOST` - your server IP or hostname
- `SSH_PORT` - usually `22`
- `SSH_USER` - the Linux user for deployment
- `SSH_PRIVATE_KEY` - the private key that can SSH into the server
- `APP_DIR` - the full server path to the project, for example `/var/www/restaurant-project`

### What the workflow does

- checks out the latest code
- connects to your server over SSH
- syncs the project files with `rsync`
- preserves:
  - `.env`
  - `data/`
  - `images/uploads/`
  - `node_modules/`
- runs `npm install --omit=dev`
- runs `npm run backup-db`
- runs `npm run check-db`
- reloads PM2

### First-time server preparation

Before the first auto deploy:

1. Create the app folder on the server
2. Upload the project once manually
3. Put your production `.env` file on the server
4. Make sure PM2 is installed and working
5. Make sure the server can accept SSH from the GitHub Actions key

## 7. Production checklist

- Use live Paystack keys
- Confirm `/healthz` returns healthy
- Confirm admin login works over `https://`
- Confirm `Secure` cookies are present in browser dev tools
- Place a real test order
- Upload a menu image
- Confirm backups are being created under the configured `STORAGE_ROOT`
- Confirm logs are being written under the configured `STORAGE_ROOT`
- Keep only one app instance for SQLite safety

## 8. Important operational notes

- Back up the whole `data/` folder regularly
- Do not delete `data/restaurant.db`, `data/*.wal`, or uploaded images
- Do not run multiple instances of this app behind a load balancer
- If traffic grows a lot, the next upgrade should be moving sessions and data storage to managed services
