# Restaurant Project Deployment Guide

This app should be hosted on a single persistent server or VPS. Do not deploy it to serverless hosting because it stores orders, images, logs, backups, and SQLite data on disk.

## Recommended Setup

- Ubuntu VPS with at least 2 GB RAM
- Node.js 20 LTS
- PM2 for process management
- Nginx as reverse proxy with HTTPS
- A domain name with SSL enabled

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
- `OWNER_PASSWORD_HASH`
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

## 6. Production checklist

- Use live Paystack keys
- Confirm `/healthz` returns healthy
- Confirm admin login works over `https://`
- Confirm `Secure` cookies are present in browser dev tools
- Place a real test order
- Upload a menu image
- Confirm backups are being created in `data/backups`
- Confirm logs are being written in `data/logs/server.log`
- Keep only one app instance for SQLite safety

## 7. Important operational notes

- Back up the whole `data/` folder regularly
- Do not delete `data/restaurant.db`, `data/*.wal`, or uploaded images
- Do not run multiple instances of this app behind a load balancer
- If traffic grows a lot, the next upgrade should be moving sessions and data storage to managed services
