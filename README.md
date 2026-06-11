# Restaurant Ordering System

This project is a restaurant ordering system with:

- customer-facing ordering pages
- Paystack payment flow
- admin dashboard
- staff dashboard
- SQLite storage
- daily closing workflow
- stock management

## Main Pages

- `index.html`: customer homepage, menu, trending items, cart entry point
- `cart.html`: customer cart, payment, receipt, delivery information
- `admin-login.html`: admin sign-in
- `admin.html`: full management dashboard
- `staff-login.html`: staff sign-in
- `staff.html`: limited staff dashboard for orders and stock
- `instant-tech-solution.html`: company profile page

## Core Scripts

- `server.js`
  Runs the Node server, serves static files, exposes API routes, manages auth, reads/writes SQLite data, and handles backups/logs.

- `script.js`
  Controls the customer homepage:
  menu rendering, category filters, hero slider, cart add flow, and opening/closing order-state display.

- `cart.js`
  Controls the cart page:
  cart sync, delivery selection, payment flow, receipt generation, and cart-side stock validation.

- `admin.js`
  Controls the admin dashboard:
  orders, menu management, users, sales reporting, daily closing, backups, logs, and receipt printing.

- `staff.js`
  Controls the staff dashboard:
  live order queue, notifications, receipt printing, and low-stock/quantity updates.

## Data And Storage

- `data/restaurant.db`
  Main SQLite database used in production/local runtime.

- `data/uploads/`
  Uploaded menu and branding images.

- `data/backups/`
  Manual and automatic database backups.

- `data/logs/server.log`
  Server-side event log.

## Important Backend Concepts

### 1. Site Data

Site data includes:

- restaurant branding
- hero content
- categories
- menu items
- delivery zones

It is normalized before saving so menu stock and availability remain consistent.

### 2. Orders

Orders are saved after successful Paystack verification.

Each order can store:

- payment reference
- totals
- customer information
- delivery information
- order note
- attended-by staff name
- status updates

### 3. Staff Activity

Staff does not see the entire order history forever.

After admin runs daily closing:

- the close time is stored
- staff activity resets from that point
- staff only sees fresh operational orders after closing

### 4. Closing History

Every closing summary is stored separately so admin can review:

- close date/time
- total orders
- total items sold
- total item sales

## User Roles

### Admin

Admin can:

- manage menu
- manage categories
- manage delivery zones
- manage public site settings
- create/block/unblock/delete staff users
- view sales reports
- run daily closing
- view logs and backups

### Staff

Staff can:

- view incoming operational orders
- print order receipts
- dispatch and deliver orders
- update item availability and remaining quantity

Staff cannot:

- change full site settings
- manage users
- use admin-only reports/logs/backups

## Receipt System

The system uses a thermal receipt style across:

- customer receipt
- admin printed order receipt
- staff printed order receipt

Receipts print through a hidden iframe so printing goes straight to the browser print dialog without opening a visible extra window.

## Environment Variables

Important `.env` values include:

- `PORT`
- `STORAGE_ROOT`
- `PAYSTACK_PUBLIC_KEY`
- `PAYSTACK_SECRET_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`
- `BACKUP_HOUR`
- `BACKUP_RETENTION_DAYS`

## Useful Commands

- `npm start`
  Start the app.

- `npm run hash-password -- yourPasswordHere`
  Generate a password hash for admin credentials.

- `npm run check-db`
  Run SQLite integrity check.

- `npm run backup-db`
  Create a manual database backup.

- `npm run check`
  Run syntax checks on the main app scripts.

## Maintenance Notes

### When changing stock logic

Update both:

- backend normalization in `server.js`
- staff/admin editing behavior in `staff.js` or `admin.js`

### When changing receipts

Keep customer, admin, and staff receipt builders aligned so they all print the same style.

### When changing closing behavior

Check all three:

- closing action in `admin.js`
- closing persistence in `server.js`
- staff activity filtering in `server.js` and `staff.js`

### When changing site branding

Branding is used in:

- homepage
- cart page
- receipts
- company page

## Deployment Notes

See:

- `DEPLOYMENT.md`
- `render.yaml`
- `ecosystem.config.js`

Those files cover deployment structure, process startup, and hosting-specific setup.
