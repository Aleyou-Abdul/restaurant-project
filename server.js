const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const sqlite3 = require("sqlite3").verbose();

const rootDir = __dirname;
const ordersFilePath = path.join(rootDir, "data", "orders.json");
const siteDataFilePath = path.join(rootDir, "data", "site-data.json");
const databaseFilePath = path.join(rootDir, "data", "restaurant.db");
const backupsDirPath = path.join(rootDir, "data", "backups");
const logsDirPath = path.join(rootDir, "data", "logs");
const logFilePath = path.join(logsDirPath, "server.log");
const uploadsDirPath = path.join(rootDir, "images", "uploads");
loadEnv(path.join(rootDir, ".env"));

const port = Number(process.env.PORT || 3000);
const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY || "";
const paystackPublicKey = process.env.PAYSTACK_PUBLIC_KEY || "";
const adminUsername = process.env.ADMIN_USERNAME || "";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || "";
const ownerPassword = process.env.OWNER_PASSWORD || "";
const ownerPasswordHash = process.env.OWNER_PASSWORD_HASH || "";
const backupHour = Number(process.env.BACKUP_HOUR || 3);
const backupRetentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 14);
const adminSessions = new Map();
const ownerSessions = new Map();
const requestRateLimits = new Map();
const sessionTtlMs = 1000 * 60 * 60 * 8;
const jsonBodyLimitBytes = 1024 * 1024;
const staticFileCache = new Map();
let ordersCache = null;
let siteDataCache = null;
const db = new sqlite3.Database(databaseFilePath);
const databaseReady = initializeDatabase();
let backupTimerId = null;

const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jfif": "image/jpeg",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".gif": "image/gif",
    ".webp": "image/webp"
};

const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const clientIp = getClientIp(req);

    try {
        await databaseReady;
    } catch (error) {
        return sendJson(res, 500, {
            ok: false,
            message: "Database could not be initialized."
        });
    }

    cleanupExpiredSessions();
    cleanupRateLimits();

    if (requestUrl.pathname.startsWith("/api/")) {
        const limitConfig = getRateLimitConfig(requestUrl.pathname);
        const rateLimitResult = consumeRateLimit(`${limitConfig.scope}:${clientIp}`, limitConfig.max, limitConfig.windowMs);

        if (!rateLimitResult.ok) {
            return sendJson(res, 429, {
                ok: false,
                message: "Too many requests. Please slow down and try again shortly."
            }, [], {
                "Retry-After": String(Math.max(1, Math.ceil(rateLimitResult.retryAfterMs / 1000)))
            });
        }
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/config") {
        return sendJson(res, 200, {
            paystackPublicKey,
            hasSecretKey: Boolean(paystackSecretKey)
        });
    }

    if (req.method === "GET" && requestUrl.pathname === "/healthz") {
        return sendJson(res, 200, {
            ok: true,
            status: "healthy",
            uptimeSeconds: Math.floor(process.uptime()),
            timestamp: new Date().toISOString()
        });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/site-data") {
        return sendJson(res, 200, await readSiteData());
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/trending-items") {
        const siteData = await readSiteData();
        const trendingItems = getTrendingItems(siteData.menuItems, await readOrders());

        return sendJson(res, 200, {
            ok: true,
            items: trendingItems
        });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/admin/session") {
        const isAuthenticated = isAdminAuthenticated(req);
        return sendJson(res, 200, {
            ok: true,
            isAuthenticated,
            hasAdminCredentials: hasConfiguredAdminCredentials()
        });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/owner/session") {
        const isAuthenticated = isOwnerAuthenticated(req);
        return sendJson(res, 200, {
            ok: true,
            isAuthenticated,
            hasOwnerPassword: hasConfiguredOwnerCredentials()
        });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/orders") {
        if (!isAdminAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized admin orders access attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as admin."
            });
        }

        const orders = await readOrders();
        return sendJson(res, 200, {
            ok: true,
            orders
        });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/admin/backups") {
        if (!isAdminAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized admin backup list access attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as admin."
            });
        }

        return sendJson(res, 200, {
            ok: true,
            backups: listDatabaseBackups()
        });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/admin/logs") {
        if (!isAdminAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized admin logs access attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as admin."
            });
        }

        return sendJson(res, 200, {
            ok: true,
            logs: readRecentLogs()
        });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/owner/report") {
        if (!isOwnerAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized owner report access attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as owner."
            });
        }

        const range = String(requestUrl.searchParams.get("range") || "all").trim().toLowerCase();
        const report = buildOwnerSalesReport(await readOrders(), range);
        return sendJson(res, 200, {
            ok: true,
            report
        });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/orders/status") {
        if (!isAdminAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized admin order status update attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as admin."
            });
        }

        const body = await readJsonBody(req);
        const reference = String(body.reference || "").trim();
        const status = String(body.status || "").trim();

        if (!reference || !status) {
            return sendJson(res, 400, {
                ok: false,
                message: "Order reference and status are required."
            });
        }

        const updatedOrder = await updateOrderStatus(reference, status);

        if (!updatedOrder) {
            return sendJson(res, 404, {
                ok: false,
                message: "Order not found."
            });
        }

        return sendJson(res, 200, {
            ok: true,
            message: "Order status updated successfully.",
            order: updatedOrder
        });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/login") {
        if (!hasConfiguredAdminCredentials()) {
            return sendJson(res, 500, {
                ok: false,
                message: "Admin credentials are not set in .env."
            });
        }

        const body = await readJsonBody(req);
        const username = String(body.username || "").trim();
        const password = String(body.password || "");

        if (username !== adminUsername || !verifyConfiguredPassword(password, adminPassword, adminPasswordHash)) {
            logServerEvent("warn", "Admin login failed.", { ip: clientIp, username });
            return sendJson(res, 401, {
                ok: false,
                message: "Invalid admin login details."
            });
        }

        const sessionToken = crypto.randomBytes(24).toString("hex");
        adminSessions.set(sessionToken, {
            createdAt: Date.now(),
            expiresAt: Date.now() + sessionTtlMs
        });
        logServerEvent("info", "Admin login successful.", { ip: clientIp, username });

        return sendJson(res, 200, {
            ok: true,
            message: "Login successful."
        }, [
            createCookie("admin_session", sessionToken, {
                httpOnly: true,
                sameSite: "Strict",
                path: "/",
                maxAge: 60 * 60 * 8,
                secure: isSecureRequest(req)
            })
        ]);
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/logout") {
        const cookies = parseCookies(req.headers.cookie || "");
        const sessionToken = cookies.admin_session;

        if (sessionToken) {
            adminSessions.delete(sessionToken);
        }

        return sendJson(res, 200, {
            ok: true,
            message: "Logged out."
        }, [
            createCookie("admin_session", "", {
                httpOnly: true,
                sameSite: "Strict",
                path: "/",
                maxAge: 0,
                secure: isSecureRequest(req)
            })
        ]);
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/owner/login") {
        if (!hasConfiguredOwnerCredentials()) {
            return sendJson(res, 500, {
                ok: false,
                message: "Owner password is not set in .env."
            });
        }

        const body = await readJsonBody(req);
        const password = String(body.password || "");

        if (!verifyConfiguredPassword(password, ownerPassword, ownerPasswordHash)) {
            logServerEvent("warn", "Owner login failed.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Invalid owner password."
            });
        }

        const sessionToken = crypto.randomBytes(24).toString("hex");
        ownerSessions.set(sessionToken, {
            createdAt: Date.now(),
            expiresAt: Date.now() + sessionTtlMs
        });
        logServerEvent("info", "Owner login successful.", { ip: clientIp });

        return sendJson(res, 200, {
            ok: true,
            message: "Owner login successful."
        }, [
            createCookie("owner_session", sessionToken, {
                httpOnly: true,
                sameSite: "Strict",
                path: "/",
                maxAge: 60 * 60 * 8,
                secure: isSecureRequest(req)
            })
        ]);
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/owner/logout") {
        const cookies = parseCookies(req.headers.cookie || "");
        const sessionToken = cookies.owner_session;

        if (sessionToken) {
            ownerSessions.delete(sessionToken);
        }

        return sendJson(res, 200, {
            ok: true,
            message: "Owner logged out."
        }, [
            createCookie("owner_session", "", {
                httpOnly: true,
                sameSite: "Strict",
                path: "/",
                maxAge: 0,
                secure: isSecureRequest(req)
            })
        ]);
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/paystack/verify") {
        if (!paystackSecretKey) {
            return sendJson(res, 500, {
                ok: false,
                message: "PAYSTACK_SECRET_KEY is not set on the server."
            });
        }

        const body = await readJsonBody(req);
        const reference = String(body.reference || "").trim();
        const expectedAmount = Number(body.expectedAmount || 0);

        if (!reference) {
            return sendJson(res, 400, {
                ok: false,
                message: "Transaction reference is required."
            });
        }

        try {
            const verification = await verifyTransaction(reference, paystackSecretKey);
            const data = verification.data || {};
            const paidAmount = Number(data.amount || 0);
            const paymentSucceeded = verification.status === true && data.status === "success";
            const amountMatches = expectedAmount > 0 ? paidAmount === expectedAmount : true;
            const orderPayload = body.order || null;

            if (!paymentSucceeded || !amountMatches) {
                return sendJson(res, 400, {
                    ok: false,
                    message: amountMatches
                        ? "Payment verification failed."
                        : "Verified payment amount does not match the cart total.",
                    transaction: data
                });
            }

            if (orderPayload) {
                const stockErrors = await validateOrderStock(orderPayload.items || []);

                if (stockErrors.length) {
                    logServerEvent("warn", "Order blocked due to stock validation failure.", {
                        ip: clientIp,
                        reference,
                        message: stockErrors[0]
                    });
                    return sendJson(res, 409, {
                        ok: false,
                        message: stockErrors[0]
                    });
                }

                await saveOrder({
                    ...orderPayload,
                    id: data.id || Date.now(),
                    reference: data.reference || reference,
                    date: new Date().toLocaleString(),
                    status: "Paid",
                    paymentChannel: data.channel || "",
                    paidAt: data.paid_at || "",
                    amountPaid: paidAmount
                });
                logServerEvent("info", "Payment verified and order saved.", {
                    ip: clientIp,
                    reference: data.reference || reference,
                    amount: paidAmount
                });
            }

            return sendJson(res, 200, {
                ok: true,
                message: "Payment verified successfully.",
                transaction: data
            });
        } catch (error) {
            logServerEvent("error", "Paystack verification failed.", {
                ip: clientIp,
                reference,
                message: error.message
            });
            return sendJson(res, 502, {
                ok: false,
                message: error.message || "Unable to verify payment."
            });
        }
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/backup") {
        if (!isAdminAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized admin backup attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as admin."
            });
        }

        try {
            const backupInfo = await createDatabaseBackup();
            logServerEvent("info", "Database backup created.", {
                ip: clientIp,
                fileName: backupInfo.fileName
            });
            return sendJson(res, 200, {
                ok: true,
                message: "Database backup created successfully.",
                backup: backupInfo
            });
        } catch (error) {
            logServerEvent("error", "Database backup failed.", {
                ip: clientIp,
                message: error.message
            });
            return sendJson(res, 500, {
                ok: false,
                message: error.message || "Could not create database backup."
            });
        }
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/site-data") {
        if (!isAdminAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized site-data save attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as admin."
            });
        }

        const body = await readJsonBody(req);
        const normalizedData = normalizeSiteData(body);
        await saveSiteData(normalizedData);
        logServerEvent("info", "Site data updated.", { ip: clientIp });
        return sendJson(res, 200, {
            ok: true,
            message: "Site data saved successfully.",
            siteData: normalizedData
        });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/upload-image") {
        if (!isAdminAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized image upload attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as admin."
            });
        }

        const body = await readJsonBody(req);
        const fileName = String(body.fileName || "").trim();
        const dataUrl = String(body.dataUrl || "").trim();

        if (!fileName || !dataUrl) {
            return sendJson(res, 400, {
                ok: false,
                message: "Image file name and data are required."
            });
        }

        try {
            const savedPath = saveUploadedImage(fileName, dataUrl);
            logServerEvent("info", "Image uploaded.", { ip: clientIp, fileName });
            return sendJson(res, 200, {
                ok: true,
                message: "Image uploaded successfully.",
                imagePath: savedPath
            });
        } catch (error) {
            logServerEvent("error", "Image upload failed.", {
                ip: clientIp,
                fileName,
                message: error.message
            });
            return sendJson(res, 400, {
                ok: false,
                message: error.message || "Unable to upload image."
            });
        }
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
        return sendJson(res, 405, {
            ok: false,
            message: "Method not allowed."
        });
    }

    serveStaticFile(req, requestUrl.pathname, res);
});

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    logServerEvent("info", "Server started.", { port });
    scheduleAutomaticBackups();
});

server.headersTimeout = 60 * 1000;
server.requestTimeout = 30 * 1000;
server.keepAliveTimeout = 5 * 1000;

process.on("uncaughtException", (error) => {
    logServerEvent("fatal", "Uncaught exception.", {
        message: error.message,
        stack: error.stack
    });
});

process.on("unhandledRejection", (reason) => {
    const errorMessage = reason instanceof Error ? reason.message : String(reason);
    const errorStack = reason instanceof Error ? reason.stack : "";
    logServerEvent("fatal", "Unhandled promise rejection.", {
        message: errorMessage,
        stack: errorStack
    });
});

process.on("SIGINT", () => shutdownServer("SIGINT"));
process.on("SIGTERM", () => shutdownServer("SIGTERM"));

function loadEnv(envPath) {
    if (!fs.existsSync(envPath)) {
        return;
    }

    const fileContent = fs.readFileSync(envPath, "utf8");
    const lines = fileContent.split(/\r?\n/);

    lines.forEach((line) => {
        const trimmedLine = line.trim();

        if (!trimmedLine || trimmedLine.startsWith("#")) {
            return;
        }

        const separatorIndex = trimmedLine.indexOf("=");
        if (separatorIndex === -1) {
            return;
        }

        const key = trimmedLine.slice(0, separatorIndex).trim();
        const value = trimmedLine.slice(separatorIndex + 1).trim();

        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(error) {
            if (error) {
                reject(error);
                return;
            }

            resolve({
                lastID: this.lastID,
                changes: this.changes
            });
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(row || null);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(rows || []);
        });
    });
}

async function initializeDatabase() {
    ensureDataDirectory();
    ensureBackupStore();
    ensureLogsStore();
    await dbRun("PRAGMA journal_mode = WAL");
    await dbRun("PRAGMA synchronous = NORMAL");
    await dbRun(`
        CREATE TABLE IF NOT EXISTS app_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS orders (
            reference TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            paid_at TEXT,
            created_at TEXT NOT NULL,
            status TEXT NOT NULL
        )
    `);
    await migrateJsonDataIfNeeded();
}

function ensureDataDirectory() {
    const dataDir = path.dirname(databaseFilePath);

    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function ensureBackupStore() {
    if (!fs.existsSync(backupsDirPath)) {
        fs.mkdirSync(backupsDirPath, { recursive: true });
    }
}

function ensureLogsStore() {
    if (!fs.existsSync(logsDirPath)) {
        fs.mkdirSync(logsDirPath, { recursive: true });
    }
}

function logServerEvent(level, message, details = {}) {
    try {
        ensureLogsStore();
        const logEntry = JSON.stringify({
            time: new Date().toISOString(),
            level,
            message,
            details
        });
        fs.appendFileSync(logFilePath, `${logEntry}\n`, "utf8");
    } catch (error) {
        // Ignore logging failures so they do not break the app.
    }
}

async function createDatabaseBackup() {
    ensureBackupStore();
    const fileName = `restaurant-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
    const backupPath = path.join(backupsDirPath, fileName);
    const sqlitePath = backupPath.replace(/'/g, "''");

    await dbRun(`VACUUM INTO '${sqlitePath}'`);

    return {
        fileName,
        path: `data/backups/${fileName}`,
        createdAt: new Date().toISOString()
    };
}

function listDatabaseBackups() {
    ensureBackupStore();

    return fs.readdirSync(backupsDirPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".db"))
        .map((entry) => {
            const filePath = path.join(backupsDirPath, entry.name);
            const stats = fs.statSync(filePath);

            return {
                fileName: entry.name,
                path: `data/backups/${entry.name}`,
                sizeBytes: stats.size,
                createdAt: new Date(stats.mtimeMs).toISOString()
            };
        })
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function readRecentLogs(limit = 20) {
    ensureLogsStore();

    if (!fs.existsSync(logFilePath)) {
        return [];
    }

    try {
        const rawLog = fs.readFileSync(logFilePath, "utf8");
        return rawLog
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(-limit)
            .reverse()
            .map((line) => safeParseJson(line))
            .filter(Boolean);
    } catch (error) {
        return [];
    }
}

function getNextBackupDelayMs() {
    const now = new Date();
    const nextRun = new Date(now);
    const safeBackupHour = Number.isFinite(backupHour) ? Math.min(23, Math.max(0, Math.floor(backupHour))) : 3;

    nextRun.setHours(safeBackupHour, 0, 0, 0);

    if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
    }

    return nextRun.getTime() - now.getTime();
}

async function pruneOldBackups() {
    ensureBackupStore();

    if (!Number.isFinite(backupRetentionDays) || backupRetentionDays <= 0) {
        return;
    }

    const cutoffTime = Date.now() - (Math.floor(backupRetentionDays) * 24 * 60 * 60 * 1000);
    const files = fs.readdirSync(backupsDirPath, { withFileTypes: true });

    files.forEach((entry) => {
        if (!entry.isFile() || !entry.name.endsWith(".db")) {
            return;
        }

        const filePath = path.join(backupsDirPath, entry.name);

        try {
            const stats = fs.statSync(filePath);

            if (stats.mtimeMs < cutoffTime) {
                fs.unlinkSync(filePath);
                logServerEvent("info", "Old backup removed.", { fileName: entry.name });
            }
        } catch (error) {
            logServerEvent("warn", "Could not prune old backup.", {
                fileName: entry.name,
                message: error.message
            });
        }
    });
}

function scheduleAutomaticBackups() {
    if (backupTimerId) {
        clearTimeout(backupTimerId);
    }

    const delayMs = getNextBackupDelayMs();
    logServerEvent("info", "Automatic backup scheduled.", {
        backupHour,
        delayMs,
        retentionDays: backupRetentionDays
    });

    backupTimerId = setTimeout(async () => {
        try {
            await createDatabaseBackup();
            await pruneOldBackups();
            logServerEvent("info", "Automatic database backup completed.");
        } catch (error) {
            logServerEvent("error", "Automatic database backup failed.", {
                message: error.message
            });
        } finally {
            scheduleAutomaticBackups();
        }
    }, delayMs);
}

async function migrateJsonDataIfNeeded() {
    const siteStateRow = await dbGet("SELECT value FROM app_state WHERE key = ?", ["site-data"]);

    if (!siteStateRow) {
        const importedSiteData = readJsonSiteDataFallback();
        await writeSiteDataToDatabase(importedSiteData);
    }

    const orderCountRow = await dbGet("SELECT COUNT(*) AS count FROM orders");

    if (!orderCountRow || Number(orderCountRow.count || 0) === 0) {
        const importedOrders = readJsonOrdersFallback();

        for (const order of importedOrders) {
            await insertOrderIntoDatabase(order);
        }
    }
}

function getClientIp(req) {
    const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    return forwardedFor || req.socket.remoteAddress || "unknown";
}

function getRateLimitConfig(pathname) {
    if (pathname === "/api/admin/login" || pathname === "/api/owner/login") {
        return {
            scope: "login",
            max: 8,
            windowMs: 10 * 60 * 1000
        };
    }

    if (pathname === "/api/paystack/verify" || pathname === "/api/upload-image") {
        return {
            scope: "heavy-api",
            max: 40,
            windowMs: 60 * 1000
        };
    }

    return {
        scope: "api",
        max: 240,
        windowMs: 60 * 1000
    };
}

function consumeRateLimit(key, max, windowMs) {
    const now = Date.now();
    const entry = requestRateLimits.get(key) || {
        count: 0,
        resetAt: now + windowMs
    };

    if (entry.resetAt <= now) {
        entry.count = 0;
        entry.resetAt = now + windowMs;
    }

    entry.count += 1;
    requestRateLimits.set(key, entry);

    if (entry.count > max) {
        return {
            ok: false,
            retryAfterMs: entry.resetAt - now
        };
    }

    return {
        ok: true,
        retryAfterMs: 0
    };
}

function cleanupRateLimits() {
    const now = Date.now();

    requestRateLimits.forEach((entry, key) => {
        if (!entry || entry.resetAt <= now) {
            requestRateLimits.delete(key);
        }
    });
}

function buildSecurityHeaders() {
    return {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Content-Security-Policy": buildContentSecurityPolicy(),
        "Permissions-Policy": "geolocation=(self)"
    };
}

function buildContentSecurityPolicy() {
    return [
        "default-src 'self'",
        "script-src 'self' https://js.paystack.co",
        "style-src 'self' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' https: data:",
        "connect-src 'self' https://api.paystack.co https://*.paystack.co",
        "frame-src 'self' https://js.paystack.co https://checkout.paystack.com https://*.paystack.co",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'"
    ].join("; ");
}

function sendJson(res, statusCode, payload, cookies = [], extraHeaders = {}) {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...buildSecurityHeaders(),
        ...extraHeaders
    };

    if (cookies.length) {
        headers["Set-Cookie"] = cookies;
    }

    sendBuffer(reqOrNullFromResponse(res), res, statusCode, body, headers);
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        let receivedBytes = 0;
        let isTooLarge = false;

        req.on("data", (chunk) => {
            if (isTooLarge) {
                return;
            }

            receivedBytes += chunk.length;

            if (receivedBytes > jsonBodyLimitBytes) {
                isTooLarge = true;
                reject(new Error("Request body is too large."));
                req.destroy();
                return;
            }

            body += chunk;
        });

        req.on("end", () => {
            if (isTooLarge) {
                return;
            }

            if (!body) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(new Error("Invalid JSON body."));
            }
        });

        req.on("error", () => {
            reject(new Error("Failed to read request body."));
        });
    });
}

function verifyTransaction(reference, secretKey) {
    const requestOptions = {
        hostname: "api.paystack.co",
        path: `/transaction/verify/${encodeURIComponent(reference)}`,
        method: "GET",
        headers: {
            Authorization: `Bearer ${secretKey}`
        }
    };

    return new Promise((resolve, reject) => {
        const request = https.request(requestOptions, (response) => {
            let rawData = "";

            response.on("data", (chunk) => {
                rawData += chunk;
            });

            response.on("end", () => {
                try {
                    const parsed = JSON.parse(rawData);

                    if (response.statusCode && response.statusCode >= 400) {
                        reject(new Error(parsed.message || "Paystack verification request failed."));
                        return;
                    }

                    resolve(parsed);
                } catch (error) {
                    reject(new Error("Could not parse Paystack verification response."));
                }
            });
        });

        request.on("error", () => {
            reject(new Error("Could not reach Paystack to verify payment."));
        });

        request.end();
    });
}

function parseCookies(cookieHeader) {
    return cookieHeader.split(";").reduce((cookies, part) => {
        const [name, ...valueParts] = part.trim().split("=");
        if (!name) {
            return cookies;
        }

        cookies[name] = decodeURIComponent(valueParts.join("=") || "");
        return cookies;
    }, {});
}

function createCookie(name, value, options = {}) {
    const segments = [`${name}=${encodeURIComponent(value)}`];

    if (options.maxAge !== undefined) {
        segments.push(`Max-Age=${options.maxAge}`);
    }

    if (options.httpOnly) {
        segments.push("HttpOnly");
    }

    if (options.sameSite) {
        segments.push(`SameSite=${options.sameSite}`);
    }

    if (options.path) {
        segments.push(`Path=${options.path}`);
    }

    if (options.secure) {
        segments.push("Secure");
    }

    return segments.join("; ");
}

function reqOrNullFromResponse(res) {
    return res && res.req ? res.req : null;
}

function shouldCompressResponse(req, headers, bodyBuffer) {
    if (!req || !bodyBuffer || bodyBuffer.length < 1024) {
        return false;
    }

    const acceptEncoding = String(req.headers["accept-encoding"] || "");
    const contentType = String(headers["Content-Type"] || "");
    const isCompressible = /^(text\/|application\/javascript|application\/json|image\/svg\+xml)/i.test(contentType);

    return isCompressible && /\b(?:br|gzip)\b/i.test(acceptEncoding);
}

function compressResponseBuffer(req, bodyBuffer) {
    const acceptEncoding = String(req.headers["accept-encoding"] || "");

    if (/\bbr\b/i.test(acceptEncoding)) {
        return {
            encoding: "br",
            body: zlib.brotliCompressSync(bodyBuffer, {
                params: {
                    [zlib.constants.BROTLI_PARAM_QUALITY]: 4
                }
            })
        };
    }

    if (/\bgzip\b/i.test(acceptEncoding)) {
        return {
            encoding: "gzip",
            body: zlib.gzipSync(bodyBuffer, {
                level: 6
            })
        };
    }

    return {
        encoding: "",
        body: bodyBuffer
    };
}

function sendBuffer(req, res, statusCode, bodyBuffer, headers) {
    let responseBody = bodyBuffer;
    const responseHeaders = { ...headers };

    if (shouldCompressResponse(req, responseHeaders, responseBody)) {
        const compressed = compressResponseBuffer(req, responseBody);
        responseBody = compressed.body;

        if (compressed.encoding) {
            responseHeaders["Content-Encoding"] = compressed.encoding;
            responseHeaders["Vary"] = appendVaryHeader(responseHeaders["Vary"], "Accept-Encoding");
        }
    }

    responseHeaders["Content-Length"] = responseBody.length;
    res.writeHead(statusCode, responseHeaders);
    res.end(responseBody);
}

function appendVaryHeader(existingValue, newValue) {
    const values = new Set(
        String(existingValue || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
    );
    values.add(newValue);
    return [...values].join(", ");
}

function isSecureRequest(req) {
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
    return forwardedProto === "https" || Boolean(req.socket && req.socket.encrypted);
}

function isAdminAuthenticated(req) {
    const cookies = parseCookies(req.headers.cookie || "");
    return Boolean(cookies.admin_session && getValidSession(adminSessions, cookies.admin_session));
}

function isOwnerAuthenticated(req) {
    const cookies = parseCookies(req.headers.cookie || "");
    return Boolean(cookies.owner_session && getValidSession(ownerSessions, cookies.owner_session));
}

function getValidSession(store, token) {
    const session = store.get(token);

    if (!session) {
        return null;
    }

    if (session.expiresAt <= Date.now()) {
        store.delete(token);
        return null;
    }

    return session;
}

function cleanupExpiredSessions() {
    cleanupSessionStore(adminSessions);
    cleanupSessionStore(ownerSessions);
}

function cleanupSessionStore(store) {
    const now = Date.now();

    store.forEach((session, token) => {
        if (!session || session.expiresAt <= now) {
            store.delete(token);
        }
    });
}

function hasConfiguredAdminCredentials() {
    return Boolean(adminUsername && (adminPassword || adminPasswordHash));
}

function hasConfiguredOwnerCredentials() {
    return Boolean(ownerPassword || ownerPasswordHash);
}

function verifyConfiguredPassword(inputPassword, plainPassword, passwordHash) {
    if (passwordHash) {
        return verifyPasswordHash(inputPassword, passwordHash);
    }

    return constantTimeEqual(String(inputPassword || ""), String(plainPassword || ""));
}

function verifyPasswordHash(password, storedHash) {
    const [algorithm, salt, expectedHash] = String(storedHash || "").split("$");

    if (algorithm !== "scrypt" || !salt || !expectedHash) {
        return false;
    }

    const derivedKey = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
    return constantTimeEqual(derivedKey, expectedHash);
}

function constantTimeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left || ""));
    const rightBuffer = Buffer.from(String(right || ""));

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function ensureOrdersStore() {
    ensureDataDirectory();
}

function ensureSiteDataStore() {
    ensureDataDirectory();
}

function ensureUploadsStore() {
    if (!fs.existsSync(uploadsDirPath)) {
        fs.mkdirSync(uploadsDirPath, { recursive: true });
    }
}

async function readOrders() {
    ensureOrdersStore();

    if (ordersCache) {
        return ordersCache;
    }

    const rows = await dbAll("SELECT payload FROM orders ORDER BY datetime(created_at) DESC");
    ordersCache = rows
        .map((row) => safeParseJson(row.payload))
        .filter(Boolean);
    return ordersCache;
}

async function saveOrder(order) {
    ensureOrdersStore();
    const orders = await readOrders();
    const alreadyExists = orders.some((entry) => entry.reference === order.reference);

    if (alreadyExists) {
        return;
    }

    await insertOrderIntoDatabase(order);
    orders.unshift(order);
    ordersCache = orders;
    await reduceMenuStock(order.items || []);
}

function saveUploadedImage(fileName, dataUrl) {
    ensureUploadsStore();

    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

    if (!match) {
        throw new Error("Invalid image upload format.");
    }

    const mimeType = match[1].toLowerCase();
    const base64Data = match[2];
    const extension = getImageExtension(fileName, mimeType);
    const safeBaseName = path.basename(fileName, path.extname(fileName))
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "menu-item";
    const uniqueName = `${safeBaseName}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${extension}`;
    const fileBuffer = Buffer.from(base64Data, "base64");

    if (!fileBuffer.length) {
        throw new Error("Uploaded image is empty.");
    }

    if (fileBuffer.length > 5 * 1024 * 1024) {
        throw new Error("Image must be 5MB or smaller.");
    }

    fs.writeFileSync(path.join(uploadsDirPath, uniqueName), fileBuffer);
    return `images/uploads/${uniqueName}`;
}

function getImageExtension(fileName, mimeType) {
    const extensionByMime = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp"
    };
    const fileExtension = path.extname(fileName).replace(".", "").toLowerCase();

    if (extensionByMime[mimeType]) {
        return extensionByMime[mimeType];
    }

    if (fileExtension && mimeTypes[`.${fileExtension}`]) {
        return fileExtension;
    }

    throw new Error("Only JPG, PNG, GIF, or WEBP images are supported.");
}

async function updateOrderStatus(reference, status) {
    ensureOrdersStore();
    const orders = await readOrders();
    const orderIndex = orders.findIndex((entry) => entry.reference === reference);

    if (orderIndex === -1) {
        return null;
    }

    orders[orderIndex] = {
        ...orders[orderIndex],
        status,
        statusUpdatedAt: new Date().toISOString()
    };

    await writeOrders(orders);
    return orders[orderIndex];
}

function defaultSiteData() {
    return {
        site: {
            restaurantName: "My Restaurant",
            logoPath: "",
            heroSlides: [],
            openingTime: "09:00",
            closingTime: "22:00",
            heroTitle: "Delicious Meals Delivered Fast",
            heroSubtitle: "Fresh, hot, and tasty dishes straight to your door.",
            phone: "08000000000",
            email: "myrestaurant@gmail.com",
            location: "Kaduna, Nigeria",
            whatsappNumber: "2348000000000"
        },
        categories: [
            "Food",
            "Grills",
            "Junk Food"
        ],
        menuItems: [
            {
                id: "jollof-rice",
                name: "Jollof Rice",
                price: 2500,
                image: "images/jollof.jfif",
                category: "Food",
                availability: "available",
                stockQuantity: null
            },
            {
                id: "burger",
                name: "Burger",
                price: 3000,
                image: "images/burger.jfif",
                category: "Junk Food",
                availability: "available",
                stockQuantity: null
            },
            {
                id: "shawarma",
                name: "Shawarma",
                price: 2000,
                image: "images/shawarma.jfif",
                category: "Grills",
                availability: "available",
                stockQuantity: null
            }
        ],
        deliveryZones: []
    };
}

function normalizeSiteData(rawData) {
    const defaults = defaultSiteData();
    const site = rawData && rawData.site ? rawData.site : {};
    const rawCategories = Array.isArray(rawData && rawData.categories) ? rawData.categories : defaults.categories;
    const menuItems = Array.isArray(rawData && rawData.menuItems) ? rawData.menuItems : [];
    const deliveryZones = Array.isArray(rawData && rawData.deliveryZones) ? rawData.deliveryZones : [];
    const categories = [...new Set(
        rawCategories
            .map((category) => String(category || "").trim())
            .filter(Boolean)
    )];
    const fallbackCategory = categories[0] || defaults.categories[0];

    return {
        site: {
            restaurantName: String(site.restaurantName || defaults.site.restaurantName).trim(),
            logoPath: normalizeAssetPath(site.logoPath || ""),
            heroSlides: Array.isArray(site.heroSlides)
                ? site.heroSlides.map((slide) => normalizeAssetPath(slide)).filter(Boolean).slice(0, 3)
                : [],
            openingTime: normalizeTimeValue(site.openingTime || defaults.site.openingTime),
            closingTime: normalizeTimeValue(site.closingTime || defaults.site.closingTime),
            heroTitle: String(site.heroTitle || defaults.site.heroTitle).trim(),
            heroSubtitle: String(site.heroSubtitle || defaults.site.heroSubtitle).trim(),
            phone: String(site.phone || defaults.site.phone).trim(),
            email: String(site.email || defaults.site.email).trim(),
            location: String(site.location || defaults.site.location).trim(),
            whatsappNumber: String(site.whatsappNumber || defaults.site.whatsappNumber).trim()
        },
        categories: categories.length ? categories : defaults.categories,
        menuItems: menuItems
            .map((item) => normalizeMenuItem(item, fallbackCategory))
            .filter((item) => item.id && item.name && item.price > 0 && item.image)
            .map((item) => ({
                ...item,
                category: categories.includes(item.category) ? item.category : fallbackCategory
            })),
        deliveryZones: deliveryZones
            .map((zone) => ({
                value: String(zone.value || "").trim(),
                label: String(zone.label || "").trim(),
                fee: Number(zone.fee || 0)
            }))
            .filter((zone) => zone.value && zone.label && zone.fee >= 0)
    };
}

async function readSiteData() {
    ensureSiteDataStore();

    if (siteDataCache) {
        return siteDataCache;
    }

    const row = await dbGet("SELECT value FROM app_state WHERE key = ?", ["site-data"]);
    siteDataCache = row ? normalizeSiteData(safeParseJson(row.value) || {}) : defaultSiteData();
    return siteDataCache;
}

async function saveSiteData(siteData) {
    ensureSiteDataStore();
    const normalizedData = normalizeSiteData(siteData);
    await writeSiteDataToDatabase(normalizedData);
    siteDataCache = normalizedData;
}

async function writeOrders(orders) {
    ordersCache = orders;
    await dbRun("BEGIN IMMEDIATE TRANSACTION");

    try {
        await dbRun("DELETE FROM orders");

        for (const order of orders) {
            await insertOrderIntoDatabase(order);
        }

        await dbRun("COMMIT");
    } catch (error) {
        await dbRun("ROLLBACK");
        throw error;
    }
}

async function insertOrderIntoDatabase(order) {
    const normalizedReference = String(order.reference || "").trim();

    if (!normalizedReference) {
        return;
    }

    await dbRun(
        `INSERT OR REPLACE INTO orders (reference, payload, paid_at, created_at, status)
         VALUES (?, ?, ?, ?, ?)`,
        [
            normalizedReference,
            JSON.stringify(order),
            String(order.paidAt || ""),
            String(order.paidAt || order.date || new Date().toISOString()),
            String(order.status || "Paid")
        ]
    );
}

async function writeSiteDataToDatabase(siteData) {
    await dbRun(
        `INSERT INTO app_state (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [
            "site-data",
            JSON.stringify(siteData),
            new Date().toISOString()
        ]
    );
}

function readJsonOrdersFallback() {
    try {
        if (!fs.existsSync(ordersFilePath)) {
            return [];
        }

        const raw = fs.readFileSync(ordersFilePath, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function readJsonSiteDataFallback() {
    try {
        if (!fs.existsSync(siteDataFilePath)) {
            return defaultSiteData();
        }

        const raw = fs.readFileSync(siteDataFilePath, "utf8");
        return normalizeSiteData(JSON.parse(raw));
    } catch (error) {
        return defaultSiteData();
    }
}

function safeParseJson(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}

function normalizeMenuItem(item, fallbackCategory) {
    const normalizedQuantity = normalizeStockQuantity(item.stockQuantity);
    let availability = normalizeAvailability(item.availability);

    if (availability !== "hidden") {
        if (normalizedQuantity === 0) {
            availability = "out-of-stock";
        } else if (normalizedQuantity !== null && normalizedQuantity <= 5) {
            availability = "low-stock";
        } else if (availability === "low-stock" && (normalizedQuantity === null || normalizedQuantity > 5)) {
            availability = "available";
        }
    }

    return {
        id: String(item.id || item.name || "").trim(),
        name: String(item.name || "").trim(),
        price: Number(item.price || 0),
        image: normalizeAssetPath(item.image || ""),
        category: String(item.category || fallbackCategory).trim() || fallbackCategory,
        availability,
        stockQuantity: normalizedQuantity
    };
}

function normalizeAvailability(value) {
    const allowedValues = new Set(["available", "low-stock", "out-of-stock", "hidden"]);
    const normalizedValue = String(value || "").trim().toLowerCase();
    return allowedValues.has(normalizedValue) ? normalizedValue : "available";
}

function normalizeStockQuantity(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const parsedValue = Number(value);

    if (!Number.isFinite(parsedValue)) {
        return null;
    }

    return Math.max(0, Math.floor(parsedValue));
}

async function validateOrderStock(orderItems) {
    const siteData = await readSiteData();
    const menuItems = Array.isArray(siteData.menuItems) ? siteData.menuItems : [];
    const stockErrors = [];

    (Array.isArray(orderItems) ? orderItems : []).forEach((orderItem) => {
        const requestedQuantity = Math.max(0, Number(orderItem && orderItem.quantity || 0));
        const orderItemId = String(orderItem && orderItem.id || "").trim();
        const orderItemName = String(orderItem && orderItem.name || "").trim();
        const menuItem = menuItems.find((item) => item.id === orderItemId) ||
            menuItems.find((item) => item.name.toLowerCase() === orderItemName.toLowerCase());

        if (!menuItem || requestedQuantity <= 0) {
            return;
        }

        if (menuItem.availability === "hidden" || menuItem.availability === "out-of-stock") {
            stockErrors.push(`${menuItem.name} is not available right now.`);
            return;
        }

        if (menuItem.stockQuantity !== null && requestedQuantity > menuItem.stockQuantity) {
            stockErrors.push(`${menuItem.name} only has ${menuItem.stockQuantity} left.`);
        }
    });

    return stockErrors;
}

async function reduceMenuStock(orderItems) {
    const siteData = await readSiteData();
    const menuItems = Array.isArray(siteData.menuItems) ? siteData.menuItems : [];
    let didChange = false;

    (Array.isArray(orderItems) ? orderItems : []).forEach((orderItem) => {
        const requestedQuantity = Math.max(0, Number(orderItem && orderItem.quantity || 0));
        const orderItemId = String(orderItem && orderItem.id || "").trim();
        const orderItemName = String(orderItem && orderItem.name || "").trim().toLowerCase();
        let itemIndex = menuItems.findIndex((item) => item.id === orderItemId);

        if (itemIndex === -1) {
            itemIndex = menuItems.findIndex((item) => item.name.toLowerCase() === orderItemName);
        }

        if (itemIndex === -1 || requestedQuantity <= 0) {
            return;
        }

        const menuItem = menuItems[itemIndex];

        if (menuItem.stockQuantity === null) {
            return;
        }

        const remainingQuantity = Math.max(0, menuItem.stockQuantity - requestedQuantity);
        let availability = menuItem.availability;

        if (availability !== "hidden") {
            if (remainingQuantity === 0) {
                availability = "out-of-stock";
            } else if (remainingQuantity <= 5) {
                availability = "low-stock";
            } else {
                availability = "available";
            }
        }

        menuItems[itemIndex] = {
            ...menuItem,
            stockQuantity: remainingQuantity,
            availability
        };
        didChange = true;
    });

    if (didChange) {
        await saveSiteData({
            ...siteData,
            menuItems
        });
    }
}

function buildOwnerSalesReport(orders, range = "all") {
    const filteredOrders = filterOrdersByRange(orders, range);
    const itemMap = new Map();

    filteredOrders.forEach((order) => {
        const items = Array.isArray(order.items) ? order.items : [];

        items.forEach((item) => {
            const itemName = String(item.name || "").trim();
            const quantity = Math.max(0, Number(item.quantity || 0));
            const unitPrice = Math.max(0, Number(item.price || 0));

            if (!itemName || !quantity || !unitPrice) {
                return;
            }

            const current = itemMap.get(itemName) || {
                name: itemName,
                quantity: 0,
                total: 0
            };

            current.quantity += quantity;
            current.total += unitPrice * quantity;
            itemMap.set(itemName, current);
        });
    });

    const items = [...itemMap.values()].sort((left, right) => right.total - left.total);

    return {
        items,
        totalItemSales: items.reduce((sum, item) => sum + item.total, 0),
        totalOrders: filteredOrders.length
    };
}

function filterOrdersByRange(orders, range) {
    if (range === "all") {
        return orders;
    }

    const now = new Date();
    const start = new Date(now);

    if (range === "today") {
        start.setHours(0, 0, 0, 0);
    } else if (range === "week") {
        const day = start.getDay();
        const diff = day === 0 ? 6 : day - 1;
        start.setDate(start.getDate() - diff);
        start.setHours(0, 0, 0, 0);
    } else if (range === "month") {
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
    } else {
        return orders;
    }

    return orders.filter((order) => {
        const sourceDate = order.paidAt || order.date;
        const parsedDate = new Date(sourceDate);
        return !Number.isNaN(parsedDate.getTime()) && parsedDate >= start && parsedDate <= now;
    });
}

function normalizeTimeValue(value) {
    const trimmedValue = String(value || "").trim();
    return /^\d{2}:\d{2}$/.test(trimmedValue) ? trimmedValue : "";
}

function normalizeAssetPath(value) {
    const trimmedValue = String(value || "").trim();

    if (!trimmedValue) {
        return "";
    }

    if (/^https?:\/\//i.test(trimmedValue)) {
        return trimmedValue;
    }

    if (/^(?:\/|\.\/)?(?:images|data)\//i.test(trimmedValue) || /^[a-z0-9/_-]+\.(?:jpg|jpeg|png|gif|webp|jfif)$/i.test(trimmedValue)) {
        return trimmedValue.replace(/\\/g, "/");
    }

    return "";
}

function getTrendingItems(menuItems, orders) {
    const quantityByName = new Map();

    orders.forEach((order) => {
        const items = Array.isArray(order && order.items) ? order.items : [];

        items.forEach((item) => {
            const itemName = String((item && item.name) || "").trim();

            if (!itemName) {
                return;
            }

            quantityByName.set(
                itemName,
                (quantityByName.get(itemName) || 0) + Math.max(1, Number(item.quantity || 1))
            );
        });
    });

    if (!quantityByName.size) {
        return menuItems.slice(0, 3).map((item) => ({
            ...item,
            orderCount: 0
        }));
    }

    return menuItems
        .map((item) => ({
            ...item,
            orderCount: quantityByName.get(item.name) || 0
        }))
        .sort((left, right) => {
            if (right.orderCount !== left.orderCount) {
                return right.orderCount - left.orderCount;
            }

            return left.name.localeCompare(right.name);
        })
        .slice(0, 3);
}

function serveStaticFile(req, requestPath, res) {
    let safePath = requestPath;

    if (safePath === "/") {
        safePath = "/index.html";
    } else if (safePath === "/admin" || safePath === "/admin/") {
        safePath = "/admin-login.html";
    }

    const normalizedPath = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(rootDir, normalizedPath);

    if (!filePath.startsWith(rootDir)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.stat(filePath, (statError, stats) => {
        if (statError || !stats.isFile()) {
            res.writeHead(statError && statError.code === "ENOENT" ? 404 : 500, {
                "Content-Type": "text/plain; charset=utf-8",
                ...buildSecurityHeaders()
            });
            res.end(statError && statError.code === "ENOENT" ? "Not found" : "Server error");
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const etag = `"${stats.size}-${Math.floor(stats.mtimeMs)}"`;
        const isHtmlFile = ext === ".html";
        const cacheControl = isHtmlFile
            ? "no-cache"
            : "public, max-age=86400";

        if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, {
                ETag: etag,
                "Cache-Control": cacheControl,
                Vary: "Accept-Encoding",
                ...buildSecurityHeaders()
            });
            res.end();
            return;
        }

        const cachedEntry = staticFileCache.get(filePath);

        if (cachedEntry && cachedEntry.etag === etag) {
            return sendBuffer(req, res, 200, cachedEntry.data, {
                "Content-Type": mimeTypes[ext] || "application/octet-stream",
                "Cache-Control": cacheControl,
                ETag: etag,
                Vary: "Accept-Encoding",
                ...buildSecurityHeaders()
            });
        }

        fs.readFile(filePath, (readError, data) => {
            if (readError) {
                res.writeHead(readError.code === "ENOENT" ? 404 : 500, {
                    "Content-Type": "text/plain; charset=utf-8",
                    ...buildSecurityHeaders()
                });
                res.end(readError.code === "ENOENT" ? "Not found" : "Server error");
                return;
            }

            if (data.length <= 2 * 1024 * 1024) {
                staticFileCache.set(filePath, {
                    etag,
                    data
                });
            }

            sendBuffer(req, res, 200, data, {
                "Content-Type": mimeTypes[ext] || "application/octet-stream",
                "Cache-Control": cacheControl,
                ETag: etag,
                Vary: "Accept-Encoding",
                ...buildSecurityHeaders()
            });
        });
    });
}

function shutdownServer(signal) {
    logServerEvent("info", "Shutdown requested.", { signal });

    if (backupTimerId) {
        clearTimeout(backupTimerId);
        backupTimerId = null;
    }

    server.close(() => {
        db.close(() => {
            process.exit(0);
        });
    });

    setTimeout(() => {
        process.exit(1);
    }, 10000).unref();
}
