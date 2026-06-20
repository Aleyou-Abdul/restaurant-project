const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const sqlite3 = require("sqlite3").verbose();

const rootDir = __dirname;
const defaultStorageRootPath = path.join(rootDir, "data");
loadEnv(path.join(rootDir, ".env"));
const storageRootPath = path.resolve(process.env.STORAGE_ROOT || defaultStorageRootPath);
const ordersFilePath = path.join(storageRootPath, "orders.json");
const siteDataFilePath = path.join(storageRootPath, "site-data.json");
const databaseFilePath = path.join(storageRootPath, "restaurant.db");
const backupsDirPath = path.join(storageRootPath, "backups");
const logsDirPath = path.join(storageRootPath, "logs");
const logFilePath = path.join(logsDirPath, "server.log");
const uploadsDirPath = path.join(storageRootPath, "uploads");

fs.mkdirSync(storageRootPath, { recursive: true });

const port = Number(process.env.PORT || 3000);
const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY || "";
const paystackPublicKey = process.env.PAYSTACK_PUBLIC_KEY || "";
const paystackSplitCode = process.env.PAYSTACK_SPLIT_CODE || "";
const paystackSubaccountCode = process.env.PAYSTACK_SUBACCOUNT_CODE || "";
const paystackTransactionChargeKobo = Number(process.env.PAYSTACK_TRANSACTION_CHARGE_KOBO || 0);
const paystackBearer = process.env.PAYSTACK_BEARER || "";
const adminUsername = process.env.ADMIN_USERNAME || "";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || "";
const defaultStaffUsername = process.env.STAFF_USERNAME || "";
const defaultStaffDisplayName = process.env.STAFF_DISPLAY_NAME || "";
const defaultStaffPassword = process.env.STAFF_PASSWORD || "";
const defaultStaffPasswordHash = process.env.STAFF_PASSWORD_HASH || "";
const backupHour = Number(process.env.BACKUP_HOUR || 3);
const backupRetentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 14);
const adminSessions = new Map();
const staffSessions = new Map();
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

// One lightweight Node server handles both the static site and the app API.
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
            hasSecretKey: Boolean(paystackSecretKey),
            requiresSplit: true,
            hasSplitConfig: hasConfiguredPaystackSplit(),
            splitConfig: getPaystackSplitConfig()
        });
    }

    if (req.method === "GET" && requestUrl.pathname === "/healthz") {
        const dbCheck = await checkDatabaseIntegrity();
        const isHealthy = dbCheck.ok;

        return sendJson(res, isHealthy ? 200 : 503, {
            ok: isHealthy,
            status: isHealthy ? "healthy" : "unhealthy",
            database: dbCheck.ok ? "healthy" : "needs-attention",
            databaseMessage: dbCheck.message,
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

    if (req.method === "GET" && requestUrl.pathname === "/api/staff/session") {
        const staffUser = await getAuthenticatedStaff(req);
        return sendJson(res, 200, {
            ok: true,
            isAuthenticated: Boolean(staffUser),
            user: staffUser ? sanitizeUser(staffUser) : null
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

    if (req.method === "GET" && requestUrl.pathname === "/api/staff/bootstrap") {
        const staffUser = await getAuthenticatedStaff(req);

        if (!staffUser) {
            logServerEvent("warn", "Unauthorized staff bootstrap access attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as staff."
            });
        }

        // Staff only sees post-closing activity so each day starts with a clean operations queue.
        return sendJson(res, 200, {
            ok: true,
            user: sanitizeUser(staffUser),
            siteData: await readSiteData(),
            orders: filterOrdersForStaffActivity(await readOrders(), await readOperationsState())
        });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/admin/users") {
        if (!isAdminAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized admin user list access attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as admin."
            });
        }

        return sendJson(res, 200, {
            ok: true,
            users: await readStaffUsers()
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

    if (req.method === "GET" && requestUrl.pathname === "/api/admin/closing-history") {
        if (!isAdminAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized admin closing history access attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as admin."
            });
        }

        return sendJson(res, 200, {
            ok: true,
            history: await readClosingHistory()
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

        const updatedOrder = await updateOrderStatus(reference, status, {
            attendedBy: "Admin"
        });

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

    if (req.method === "GET" && requestUrl.pathname === "/api/admin/sales-report") {
        if (!isAdminAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized admin sales report access attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as admin."
            });
        }

        const range = String(requestUrl.searchParams.get("range") || "all").trim().toLowerCase();
        const report = buildSalesReport(await readOrders(), range);
        return sendJson(res, 200, {
            ok: true,
            report
        });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/staff/orders/status") {
        const staffUser = await getAuthenticatedStaff(req);

        if (!staffUser) {
            logServerEvent("warn", "Unauthorized staff order status update attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as staff."
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

        const updatedOrder = await updateOrderStatus(reference, status, {
            attendedBy: staffUser.displayName || staffUser.username
        });

        if (!updatedOrder) {
            return sendJson(res, 404, {
                ok: false,
                message: "Order not found."
            });
        }

        logServerEvent("info", "Staff updated order status.", {
            ip: clientIp,
            username: staffUser.username,
            reference,
            status
        });

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

    if (req.method === "POST" && requestUrl.pathname === "/api/staff/login") {
        const body = await readJsonBody(req);
        const username = normalizeUsername(body.username || "");
        const password = String(body.password || "");
        const user = await findStaffUser(username);

        if (!user || !verifyPasswordHash(password, user.passwordHash)) {
            logServerEvent("warn", "Staff login failed.", { ip: clientIp, username });
            return sendJson(res, 401, {
                ok: false,
                message: "Invalid user login details."
            });
        }

        if (user.blocked) {
            logServerEvent("warn", "Blocked staff login attempt.", { ip: clientIp, username });
            return sendJson(res, 403, {
                ok: false,
                message: "This staff account is blocked. Contact admin."
            });
        }

        const sessionToken = crypto.randomBytes(24).toString("hex");
        staffSessions.set(sessionToken, {
            username: user.username,
            displayName: user.displayName,
            createdAt: Date.now(),
            expiresAt: Date.now() + sessionTtlMs
        });
        logServerEvent("info", "Staff login successful.", { ip: clientIp, username });

        return sendJson(res, 200, {
            ok: true,
            message: "Staff login successful.",
            user: sanitizeUser(user)
        }, [
            createCookie("staff_session", sessionToken, {
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

    if (req.method === "POST" && requestUrl.pathname === "/api/staff/logout") {
        const cookies = parseCookies(req.headers.cookie || "");
        const sessionToken = cookies.staff_session;

        if (sessionToken) {
            staffSessions.delete(sessionToken);
        }

        return sendJson(res, 200, {
            ok: true,
            message: "Staff logged out."
        }, [
            createCookie("staff_session", "", {
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

        if (!hasConfiguredPaystackSplit()) {
            return sendJson(res, 500, {
                ok: false,
                message: "Payment split is not configured. Add PAYSTACK_SPLIT_CODE before accepting orders."
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

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/users") {
        if (!isAdminAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized admin user save attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as admin."
            });
        }

        const body = await readJsonBody(req);
        const username = normalizeUsername(body.username || "");
        const displayName = String(body.displayName || "").trim();
        const password = String(body.password || "");

        if (!username || !displayName) {
            return sendJson(res, 400, {
                ok: false,
                message: "Display name and username are required."
            });
        }

        if (username === adminUsername) {
            return sendJson(res, 400, {
                ok: false,
                message: "That username is reserved for admin."
            });
        }

        const existingUser = await findStaffUser(username);

        if (!existingUser && !password) {
            return sendJson(res, 400, {
                ok: false,
                message: "Enter a password for the new user."
            });
        }

        await saveStaffUser({
            username,
            displayName,
            passwordHash: password ? createPasswordHash(password) : existingUser.passwordHash,
            blocked: existingUser ? existingUser.blocked : false
        });

        logServerEvent("info", existingUser ? "Staff user updated." : "Staff user created.", {
            ip: clientIp,
            username
        });

        return sendJson(res, 200, {
            ok: true,
            message: existingUser ? "User updated successfully." : "User created successfully.",
            users: await readStaffUsers()
        });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/users/delete") {
        if (!isAdminAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized admin user delete attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as admin."
            });
        }

        const body = await readJsonBody(req);
        const username = normalizeUsername(body.username || "");

        if (!username) {
            return sendJson(res, 400, {
                ok: false,
                message: "Username is required."
            });
        }

        await deleteStaffUser(username);
        clearStaffSessionsForUsername(username);
        logServerEvent("info", "Staff user deleted.", {
            ip: clientIp,
            username
        });

        return sendJson(res, 200, {
            ok: true,
            message: "User deleted successfully.",
            users: await readStaffUsers()
        });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/users/block") {
        if (!isAdminAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized admin user block toggle attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as admin."
            });
        }

        const body = await readJsonBody(req);
        const username = normalizeUsername(body.username || "");
        const blocked = Boolean(body.blocked);

        if (!username) {
            return sendJson(res, 400, {
                ok: false,
                message: "Username is required."
            });
        }

        const updatedUser = await setStaffUserBlocked(username, blocked);

        if (!updatedUser) {
            return sendJson(res, 404, {
                ok: false,
                message: "User not found."
            });
        }

        if (blocked) {
            clearStaffSessionsForUsername(username);
        }

        logServerEvent("info", blocked ? "Staff user blocked." : "Staff user unblocked.", {
            ip: clientIp,
            username
        });

        return sendJson(res, 200, {
            ok: true,
            message: blocked ? "User blocked successfully." : "User unblocked successfully.",
            users: await readStaffUsers()
        });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/staff/menu-stock") {
        const staffUser = await getAuthenticatedStaff(req);

        if (!staffUser) {
            logServerEvent("warn", "Unauthorized staff stock update attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as staff."
            });
        }

        const body = await readJsonBody(req);
        const itemId = String(body.itemId || "").trim();
        const availability = String(body.availability || "available").trim().toLowerCase();
        const rawStockQuantity = body.stockQuantity;
        const stockQuantity = rawStockQuantity === "" || rawStockQuantity === null || rawStockQuantity === undefined
            ? null
            : Math.max(0, Math.floor(Number(rawStockQuantity || 0)));

        if (!itemId) {
            return sendJson(res, 400, {
                ok: false,
                message: "Item ID is required."
            });
        }

        if (stockQuantity !== null && !Number.isFinite(stockQuantity)) {
            return sendJson(res, 400, {
                ok: false,
                message: "Enter a valid stock quantity."
            });
        }

        const allowedAvailability = new Set(["available", "low-stock", "out-of-stock", "hidden"]);

        if (!allowedAvailability.has(availability)) {
            return sendJson(res, 400, {
                ok: false,
                message: "Invalid availability value."
            });
        }

        const updatedItem = await updateMenuItemStock(itemId, availability, stockQuantity);

        if (!updatedItem) {
            return sendJson(res, 404, {
                ok: false,
                message: "Menu item not found."
            });
        }

        logServerEvent("info", "Staff updated item stock.", {
            ip: clientIp,
            username: staffUser.username,
            itemId
        });

        return sendJson(res, 200, {
            ok: true,
            message: "Item stock updated successfully.",
            item: updatedItem
        });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/close-day") {
        if (!isAdminAuthenticated(req)) {
            logServerEvent("warn", "Unauthorized admin closing attempt.", { ip: clientIp });
            return sendJson(res, 401, {
                ok: false,
                message: "Unauthorized. Please log in as admin."
            });
        }

        const orders = await readOrders();
        const report = buildSalesReport(orders, "today");
        const operationsState = await saveOperationsState({
            lastClosingAt: new Date().toISOString()
        });
        await saveClosingHistoryEntry(report, operationsState.lastClosingAt);

        logServerEvent("info", "Daily closing completed.", {
            ip: clientIp,
            lastClosingAt: operationsState.lastClosingAt
        });

        return sendJson(res, 200, {
            ok: true,
            message: "Daily closing completed successfully.",
            report,
            operationsState
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
    await dbRun("PRAGMA busy_timeout = 5000");
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
    await dbRun(`
        CREATE TABLE IF NOT EXISTS staff_users (
            username TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            blocked INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS closing_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payload TEXT NOT NULL,
            closed_at TEXT NOT NULL
        )
    `);
    await ensureTableColumn("staff_users", "blocked", "INTEGER NOT NULL DEFAULT 0");
    await ensureDefaultStaffUserFromEnv();
    await migrateJsonDataIfNeeded();
    const integrityResult = await checkDatabaseIntegrity();

    if (!integrityResult.ok) {
        throw new Error(`Database integrity check failed: ${integrityResult.message}`);
    }
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

async function checkDatabaseIntegrity() {
    try {
        const row = await dbGet("PRAGMA integrity_check");
        const message = String(row && (row.integrity_check || Object.values(row)[0]) || "").trim() || "unknown";

        return {
            ok: message.toLowerCase() === "ok",
            message
        };
    } catch (error) {
        return {
            ok: false,
            message: error.message || "Could not run integrity check."
        };
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
    if (pathname === "/api/admin/login" || pathname === "/api/staff/login") {
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
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
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

function getAuthenticatedStaffSession(req) {
    const cookies = parseCookies(req.headers.cookie || "");
    const session = cookies.staff_session ? getValidSession(staffSessions, cookies.staff_session) : null;
    return session ? session : null;
}

async function getAuthenticatedStaff(req) {
    const session = getAuthenticatedStaffSession(req);

    if (!session || !session.username) {
        return null;
    }

    const user = await findStaffUser(session.username);

    if (!user || user.blocked) {
        clearStaffSessionsForUsername(session.username);
        return null;
    }

    return user;
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
    cleanupSessionStore(staffSessions);
}

function cleanupSessionStore(store) {
    const now = Date.now();

    store.forEach((session, token) => {
        if (!session || session.expiresAt <= now) {
            store.delete(token);
        }
    });
}

async function ensureTableColumn(tableName, columnName, columnDefinition) {
    const rows = await dbAll(`PRAGMA table_info(${tableName})`);
    const hasColumn = rows.some((row) => String(row.name || "").toLowerCase() === String(columnName || "").toLowerCase());

    if (!hasColumn) {
        await dbRun(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
    }
}

function hasConfiguredAdminCredentials() {
    return Boolean(adminUsername && (adminPassword || adminPasswordHash));
}

function hasConfiguredPaystackSplit() {
    return Boolean(paystackSplitCode || paystackSubaccountCode);
}

function getPaystackSplitConfig() {
    if (paystackSplitCode) {
        return {
            mode: "split-code",
            splitCode: paystackSplitCode
        };
    }

    if (paystackSubaccountCode) {
        return {
            mode: "subaccount",
            subaccountCode: paystackSubaccountCode,
            transactionChargeKobo: paystackTransactionChargeKobo > 0 ? paystackTransactionChargeKobo : 0,
            bearer: ["account", "subaccount"].includes(paystackBearer) ? paystackBearer : ""
        };
    }

    return null;
}

function verifyConfiguredPassword(inputPassword, plainPassword, passwordHash) {
    if (passwordHash) {
        return verifyPasswordHash(inputPassword, passwordHash);
    }

    return constantTimeEqual(String(inputPassword || ""), String(plainPassword || ""));
}

function createPasswordHash(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derivedKey = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
    return `scrypt$${salt}$${derivedKey}`;
}

async function ensureDefaultStaffUserFromEnv() {
    const username = normalizeUsername(defaultStaffUsername);
    const displayName = String(defaultStaffDisplayName || defaultStaffUsername || "").trim();
    const passwordHash = String(defaultStaffPasswordHash || "").trim() ||
        (defaultStaffPassword ? createPasswordHash(defaultStaffPassword) : "");

    if (!username || !displayName || !passwordHash) {
        return;
    }

    // Free Render demo storage can reset, so env-based staff credentials recreate the main staff user on startup.
    await saveStaffUser({
        username,
        displayName,
        passwordHash,
        blocked: false
    });
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

async function updateOrderStatus(reference, status, extra = {}) {
    ensureOrdersStore();
    const orders = await readOrders();
    const orderIndex = orders.findIndex((entry) => entry.reference === reference);

    if (orderIndex === -1) {
        return null;
    }

    orders[orderIndex] = {
        ...orders[orderIndex],
        status,
        attendedBy: extra.attendedBy || orders[orderIndex].attendedBy || "",
        statusUpdatedAt: new Date().toISOString()
    };

    await writeOrders(orders);
    return orders[orderIndex];
}

async function updateMenuItemStock(itemId, availability, stockQuantity) {
    const siteData = await readSiteData();
    const itemIndex = (siteData.menuItems || []).findIndex((item) => String(item.id || "") === String(itemId || ""));

    if (itemIndex === -1) {
        return null;
    }

    const nextItems = [...siteData.menuItems];
    const currentItem = nextItems[itemIndex];
    // Reuse menu normalization so staff edits follow the same stock/availability rules as admin edits.
    nextItems[itemIndex] = normalizeMenuItem({
        ...currentItem,
        ...nextItems[itemIndex],
        availability,
        stockQuantity
    }, currentItem.category || ((siteData.categories || [])[0] || "Food"));

    await saveSiteData({
        ...siteData,
        menuItems: nextItems
    });

    return nextItems[itemIndex];
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
            whatsappNumber: "2348000000000",
            printerPaperWidth: 80,
            printerContentWidth: 72,
            printerScale: 0.9
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
    const printerPaperWidth = normalizePrinterNumber(site.printerPaperWidth, defaults.site.printerPaperWidth, 58, 80);
    const defaultPrinterContentWidth = printerPaperWidth === 58 ? 50 : defaults.site.printerContentWidth;

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
            whatsappNumber: String(site.whatsappNumber || defaults.site.whatsappNumber).trim(),
            printerPaperWidth,
            printerContentWidth: normalizePrinterNumber(site.printerContentWidth, defaultPrinterContentWidth, 42, printerPaperWidth === 58 ? 54 : 76),
            printerScale: normalizePrinterNumber(site.printerScale, defaults.site.printerScale, 0.8, 1)
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

function normalizePrinterNumber(value, fallbackValue, minValue, maxValue) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return fallbackValue;
    }

    return Math.min(maxValue, Math.max(minValue, numericValue));
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

function normalizeUsername(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "");
}

function sanitizeUser(user) {
    if (!user) {
        return null;
    }

    return {
        username: user.username,
        displayName: user.displayName,
        blocked: Boolean(user.blocked),
        createdAt: user.createdAt || ""
    };
}

function defaultOperationsState() {
    return {
        lastClosingAt: ""
    };
}

function normalizeOperationsState(rawState) {
    const state = rawState && typeof rawState === "object" ? rawState : {};
    const lastClosingAt = String(state.lastClosingAt || "").trim();

    return {
        lastClosingAt: lastClosingAt && !Number.isNaN(new Date(lastClosingAt).getTime()) ? lastClosingAt : ""
    };
}

async function readOperationsState() {
    const row = await dbGet("SELECT value FROM app_state WHERE key = ?", ["operations-state"]);
    return row ? normalizeOperationsState(safeParseJson(row.value) || {}) : defaultOperationsState();
}

async function saveOperationsState(state) {
    const normalizedState = normalizeOperationsState(state);
    await dbRun(
        `INSERT INTO app_state (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [
            "operations-state",
            JSON.stringify(normalizedState),
            new Date().toISOString()
        ]
    );
    return normalizedState;
}

// Closing history keeps a printable audit trail of end-of-day summaries without touching order records.
async function saveClosingHistoryEntry(report, closedAt) {
    const totalItemsSold = (report.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const entry = {
        closedAt: String(closedAt || new Date().toISOString()),
        totalOrders: Number(report.totalOrders || 0),
        totalItemsSold,
        totalItemSales: Number(report.totalItemSales || 0),
        items: Array.isArray(report.items) ? report.items : []
    };

    await dbRun(
        `INSERT INTO closing_history (payload, closed_at)
         VALUES (?, ?)`,
        [JSON.stringify(entry), entry.closedAt]
    );
}

async function readClosingHistory(limit = 20) {
    const rows = await dbAll(
        `SELECT payload, closed_at
         FROM closing_history
         ORDER BY datetime(closed_at) DESC
         LIMIT ?`,
        [limit]
    );

    return rows
        .map((row) => {
            const parsed = safeParseJson(row.payload);

            if (!parsed) {
                return null;
            }

            return {
                closedAt: row.closed_at,
                totalOrders: Number(parsed.totalOrders || 0),
                totalItemsSold: Number(parsed.totalItemsSold || 0),
                totalItemSales: Number(parsed.totalItemSales || 0),
                items: Array.isArray(parsed.items) ? parsed.items : []
            };
        })
        .filter(Boolean);
}

function getOrderActivityTimestamp(order) {
    const candidates = [
        order && order.statusUpdatedAt,
        order && order.paidAt,
        order && order.date
    ];

    for (const candidate of candidates) {
        const parsed = new Date(candidate || "");

        if (!Number.isNaN(parsed.getTime())) {
            return parsed.getTime();
        }
    }

    return 0;
}

function filterOrdersForStaffActivity(orders, operationsState) {
    const cutoffTime = operationsState && operationsState.lastClosingAt
        ? new Date(operationsState.lastClosingAt).getTime()
        : 0;

    if (!cutoffTime) {
        return orders;
    }

    return orders.filter((order) => getOrderActivityTimestamp(order) > cutoffTime);
}

async function readStaffUsers() {
    const rows = await dbAll(`
        SELECT username, display_name, blocked, created_at
        FROM staff_users
        ORDER BY datetime(created_at) ASC, username ASC
    `);

    return rows.map((row) => ({
        username: row.username,
        displayName: row.display_name,
        blocked: Boolean(row.blocked),
        createdAt: row.created_at
    }));
}

async function findStaffUser(username) {
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername) {
        return null;
    }

    const row = await dbGet(`
        SELECT username, display_name, password_hash, created_at, updated_at
             , blocked
        FROM staff_users
        WHERE username = ?
    `, [normalizedUsername]);

    if (!row) {
        return null;
    }

    return {
        username: row.username,
        displayName: row.display_name,
        passwordHash: row.password_hash,
        blocked: Boolean(row.blocked),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function saveStaffUser(user) {
    const username = normalizeUsername(user.username);
    const displayName = String(user.displayName || "").trim();
    const passwordHash = String(user.passwordHash || "").trim();
    const now = new Date().toISOString();

    if (!username || !displayName || !passwordHash) {
        throw new Error("User details are incomplete.");
    }

    await dbRun(`
        INSERT INTO staff_users (username, display_name, password_hash, blocked, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET
            display_name = excluded.display_name,
            password_hash = excluded.password_hash,
            blocked = excluded.blocked,
            updated_at = excluded.updated_at
    `, [username, displayName, passwordHash, user.blocked ? 1 : 0, now, now]);
}

async function deleteStaffUser(username) {
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername) {
        return;
    }

    await dbRun("DELETE FROM staff_users WHERE username = ?", [normalizedUsername]);
}

function clearStaffSessionsForUsername(username) {
    const normalizedUsername = normalizeUsername(username);

    staffSessions.forEach((session, token) => {
        if (session && session.username === normalizedUsername) {
            staffSessions.delete(token);
        }
    });
}

async function setStaffUserBlocked(username, blocked) {
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername) {
        return null;
    }

    const existingUser = await findStaffUser(normalizedUsername);

    if (!existingUser) {
        return null;
    }

    await saveStaffUser({
        ...existingUser,
        blocked
    });

    return findStaffUser(normalizedUsername);
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

function buildSalesReport(orders, range = "all") {
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
    } else if (safePath === "/staff" || safePath === "/staff/") {
        safePath = "/staff-login.html";
    }

    if (safePath.startsWith("/images/uploads/")) {
        return serveUploadedFile(req, safePath, res);
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

function serveUploadedFile(req, requestPath, res) {
    const relativeFileName = requestPath.replace(/^\/images\/uploads\//, "");
    const normalizedFileName = path.normalize(relativeFileName).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(uploadsDirPath, normalizedFileName);

    if (!filePath.startsWith(uploadsDirPath)) {
        res.writeHead(403, {
            "Content-Type": "text/plain; charset=utf-8",
            ...buildSecurityHeaders()
        });
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

        if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, {
                ETag: etag,
                "Cache-Control": "public, max-age=86400",
                ...buildSecurityHeaders()
            });
            res.end();
            return;
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

            res.writeHead(200, {
                "Content-Type": mimeTypes[ext] || "application/octet-stream",
                "Content-Length": data.length,
                "Cache-Control": "public, max-age=86400",
                ETag: etag,
                ...buildSecurityHeaders()
            });
            res.end(data);
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
