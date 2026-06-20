document.addEventListener("DOMContentLoaded", () => {
    const DEFAULT_MENU_IMAGE = "images/menu-placeholder.svg";
    const adminDashboardEl = document.getElementById("admin-dashboard");
    const adminStatusEl = document.getElementById("admin-status");
    const adminPageTitleEl = document.getElementById("admin-page-title");
    const adminNotificationBtn = document.getElementById("admin-notification-btn");
    const adminNotificationCountEl = document.getElementById("admin-notification-count");
    const adminNotificationLabelEl = document.getElementById("admin-notification-label");
    const adminNotificationPanelEl = document.getElementById("admin-notification-panel");
    const adminNotificationListEl = document.getElementById("admin-notification-list");
    const siteLogoPathEl = document.getElementById("site-logo-path");
    const siteLogoUploadBtn = document.getElementById("site-logo-upload-btn");
    const siteLogoUploadInputEl = document.getElementById("site-logo-upload-input");
    const siteLogoUploadStatusEl = document.getElementById("site-logo-upload-status");
    const siteLogoPreviewEl = document.getElementById("site-logo-preview");
    const heroSlideControls = [1, 2, 3].map((index) => ({
        pathEl: document.getElementById(`hero-slide-${index}-path`),
        uploadBtn: document.getElementById(`hero-slide-${index}-upload-btn`),
        uploadInputEl: document.getElementById(`hero-slide-${index}-upload-input`),
        uploadStatusEl: document.getElementById(`hero-slide-${index}-upload-status`),
        previewEl: document.getElementById(`hero-slide-${index}-preview`),
        label: `slide ${index}`
    }));
    const refreshOrdersBtn = document.getElementById("refresh-orders-btn");
    const dashboardRefreshBtn = document.getElementById("dashboard-refresh-btn");
    const refreshMonitoringBtn = document.getElementById("refresh-monitoring-btn");
    const backupDatabaseBtn = document.getElementById("backup-database-btn");
    const saveSiteDataBtn = document.getElementById("save-site-data-btn");
    const adminLogoutBtn = document.getElementById("admin-logout-btn");
    const ordersListEl = document.getElementById("orders-list");
    const ordersEmptyEl = document.getElementById("orders-empty");
    const ordersTableBodyEl = document.getElementById("orders-table-body");
    const recentOrdersBodyEl = document.getElementById("recent-orders-body");
    const menuAdminListEl = document.getElementById("menu-admin-list");
    const categoriesAdminListEl = document.getElementById("categories-admin-list");
    const zonesAdminListEl = document.getElementById("zones-admin-list");
    const addMenuItemBtn = document.getElementById("add-menu-item-btn");
    const addCategoryBtn = document.getElementById("add-category-btn");
    const addZoneBtn = document.getElementById("add-zone-btn");
    const createStaffUserBtn = document.getElementById("create-staff-user-btn");
    const adminNavButtons = [...document.querySelectorAll(".admin-nav-btn")];
    const adminSections = [...document.querySelectorAll(".admin-section")];
    const statTotalOrdersEl = document.getElementById("stat-total-orders");
    const statPendingOrdersEl = document.getElementById("stat-pending-orders");
    const statTotalRevenueEl = document.getElementById("stat-total-revenue");
    const backupListEl = document.getElementById("backup-list");
    const logListEl = document.getElementById("log-list");
    const staffUsersListEl = document.getElementById("staff-users-list");
    const staffUsersEmptyEl = document.getElementById("staff-users-empty");
    const adminSalesRangeEl = document.getElementById("admin-sales-range");
    const adminSalesRefreshBtn = document.getElementById("admin-sales-refresh-btn");
    const adminSalesClosingBtn = document.getElementById("admin-sales-closing-btn");
    const adminSalesDownloadBtn = document.getElementById("admin-sales-download-btn");
    const adminSalesPrintBtn = document.getElementById("admin-sales-print-btn");
    const adminSalesBodyEl = document.getElementById("admin-sales-body");
    const adminSalesTotalOrdersEl = document.getElementById("admin-sales-total-orders");
    const adminSalesTotalQuantityEl = document.getElementById("admin-sales-total-quantity");
    const adminSalesTotalValueEl = document.getElementById("admin-sales-total-value");
    const adminSalesFooterTotalEl = document.getElementById("admin-sales-footer-total");
    const adminClosingHistoryEl = document.getElementById("admin-closing-history");
    const printerPaperWidthEl = document.getElementById("site-printer-paper-width");
    const printerContentWidthEl = document.getElementById("site-printer-content-width");
    const printerScaleEl = document.getElementById("site-printer-scale");
    const printerTestBtn = document.getElementById("site-printer-test-btn");

    let ordersCache = [];
    let previousPendingCount = 0;
    let hasLoadedOrdersOnce = false;
    let autoRefreshTimerId = null;
    let isAutoRefreshing = false;
    let salesReportCache = {
        items: [],
        totalItemSales: 0,
        totalOrders: 0
    };

    function getSiteBranding() {
        return {
            restaurantName: readInput("site-name") || "My Restaurant",
            logoPath: readInput("site-logo-path") || "",
            phone: readInput("site-phone") || "",
            location: readInput("site-location") || ""
        };
    }

    function getPrinterSettings(site = {}) {
        const paperWidth = Number(site.printerPaperWidth || printerPaperWidthEl.value || 80);
        const contentWidth = Number(site.printerContentWidth || printerContentWidthEl.value || (paperWidth >= 80 ? 72 : 50));
        const scale = Number(site.printerScale || printerScaleEl.value || 0.9);

        return {
            paperWidth: paperWidth === 58 ? 58 : 80,
            contentWidth: Math.min(Math.max(contentWidth, 42), paperWidth === 58 ? 54 : 76),
            scale: Math.min(Math.max(scale, 0.8), 1)
        };
    }

    function syncPrinterContentLimit() {
        const paperWidth = Number(printerPaperWidthEl.value || 80) === 58 ? 58 : 80;
        const maxWidth = paperWidth === 58 ? 54 : 76;
        const defaultWidth = paperWidth === 58 ? 50 : 72;
        const currentWidth = Number(printerContentWidthEl.value || defaultWidth);

        printerContentWidthEl.max = String(maxWidth);
        printerContentWidthEl.placeholder = String(defaultWidth);

        if (!printerContentWidthEl.value || currentWidth > maxWidth) {
            printerContentWidthEl.value = String(defaultWidth);
        }
    }

    function formatPrice(amount) {
        return `\u20A6${Number(amount || 0)}`;
    }

    function formatDateTime(value) {
        const parsedDate = new Date(value);

        if (Number.isNaN(parsedDate.getTime())) {
            return "-";
        }

        return parsedDate.toLocaleString("en-NG", {
            dateStyle: "medium",
            timeStyle: "short"
        });
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function getSafeImageSrc(value) {
        const trimmedValue = String(value || "").trim();
        return /^(?:https?:\/\/|\/|\.\/|images\/)/i.test(trimmedValue) ? trimmedValue : DEFAULT_MENU_IMAGE;
    }

    function getOrderStatus(order) {
        return String(order.status || "Paid");
    }

    function isPendingOrder(order) {
        return getOrderStatus(order).toLowerCase() === "paid";
    }

    function isDispatchedOrder(order) {
        return getOrderStatus(order).toLowerCase() === "dispatched";
    }

    function getFulfillmentLabel(order) {
        return order && order.fulfillmentType === "pickup" ? "Pickup" : "Delivery";
    }

    async function fetchJson(url, options) {
        const response = await fetch(url, {
            cache: "no-store",
            ...options
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Request failed.");
        }

        return data;
    }

    function setStatus(message, type) {
        adminStatusEl.textContent = message;
        adminStatusEl.className = `payment-status ${type}`;
    }

    function showDashboard() {
        adminDashboardEl.hidden = false;
    }

    function setActiveSection(sectionName) {
        const titles = {
            dashboard: "Customer Orders",
            orders: "Verified Orders",
            menu: "Menu Management",
            users: "User Management",
            sales: "Sales Report",
            settings: "Website Settings"
        };

        adminNavButtons.forEach((button) => {
            button.classList.toggle("is-active", button.dataset.section === sectionName);
        });

        adminSections.forEach((section) => {
            section.classList.toggle("is-active", section.id === `admin-section-${sectionName}`);
        });

        adminPageTitleEl.textContent = titles[sectionName] || "Admin Dashboard";
    }

    function readInput(id) {
        return document.getElementById(id).value.trim();
    }

    function populateSiteSettings(site) {
        siteLogoPathEl.value = site.logoPath || "";
        document.getElementById("site-name").value = site.restaurantName || "";
        document.getElementById("site-phone").value = site.phone || "";
        document.getElementById("site-email").value = site.email || "";
        document.getElementById("site-location").value = site.location || "";
        document.getElementById("site-whatsapp").value = site.whatsappNumber || "";
        document.getElementById("site-hero-title").value = site.heroTitle || "";
        document.getElementById("site-hero-subtitle").value = site.heroSubtitle || "";
        document.getElementById("site-opening-time").value = site.openingTime || "";
        document.getElementById("site-closing-time").value = site.closingTime || "";
        const printerSettings = getPrinterSettings(site);
        printerPaperWidthEl.value = String(printerSettings.paperWidth);
        printerContentWidthEl.value = String(printerSettings.contentWidth);
        printerScaleEl.value = String(printerSettings.scale);
        syncPrinterContentLimit();
        updateSiteLogoPreview(site.logoPath || "");
        updateHeroSlideControls(site.heroSlides || []);
    }

    function collectRepeatRows(container, mapper) {
        return [...container.children]
            .map((row) => mapper(row))
            .filter(Boolean);
    }

    function getCurrentCategories() {
        return collectRepeatRows(categoriesAdminListEl, (row) => {
            const value = row.querySelector('[data-field="category"]').value.trim();
            return value || null;
        });
    }

    function buildCategoryOptions(selectedCategory = "") {
        const categories = getCurrentCategories();

        if (!categories.length) {
            return '<option value="">Select category</option>';
        }

        return categories
            .map((category) => `<option value="${escapeHtml(category)}" ${category === selectedCategory ? "selected" : ""}>${escapeHtml(category)}</option>`)
            .join("");
    }

    function refreshCategorySelectOptions() {
        const categories = getCurrentCategories();

        menuAdminListEl.querySelectorAll('[data-field="category"]').forEach((select) => {
            const currentValue = select.value;
            select.innerHTML = buildCategoryOptions(currentValue);
            select.value = categories.includes(currentValue) ? currentValue : (categories[0] || "");
        });
    }

    function updateMenuItemImagePreview(row, imagePath) {
        const previewEl = row.querySelector(".admin-image-preview");
        const statusEl = row.querySelector(".admin-upload-status");

        if (!imagePath) {
            previewEl.hidden = true;
            previewEl.removeAttribute("src");
            statusEl.textContent = "No image uploaded yet.";
            return;
        }

        previewEl.src = imagePath;
        previewEl.hidden = false;
        statusEl.textContent = imagePath === DEFAULT_MENU_IMAGE
            ? "Using default placeholder image."
            : `Saved image: ${imagePath}`;
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Could not read the selected image."));
            reader.readAsDataURL(file);
        });
    }

    async function uploadMenuImage(file) {
        const dataUrl = await readFileAsDataUrl(file);
        const response = await fetchJson("/api/upload-image", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                fileName: file.name,
                dataUrl
            })
        });

        return response.imagePath || "";
    }

    function updateSiteLogoPreview(imagePath) {
        if (!imagePath) {
            siteLogoPreviewEl.hidden = true;
            siteLogoPreviewEl.removeAttribute("src");
            siteLogoUploadStatusEl.textContent = "No logo uploaded yet.";
            return;
        }

        siteLogoPreviewEl.src = imagePath;
        siteLogoPreviewEl.hidden = false;
        siteLogoUploadStatusEl.textContent = `Saved logo: ${imagePath}`;
    }

    function updateUploadPreview(control, imagePath, emptyMessage) {
        if (!imagePath) {
            control.previewEl.hidden = true;
            control.previewEl.removeAttribute("src");
            control.uploadStatusEl.textContent = emptyMessage;
            return;
        }

        control.previewEl.src = imagePath;
        control.previewEl.hidden = false;
        control.uploadStatusEl.textContent = `Saved image: ${imagePath}`;
    }

    function updateHeroSlideControls(slides) {
        heroSlideControls.forEach((control, index) => {
            const imagePath = slides[index] || "";
            control.pathEl.value = imagePath;
            updateUploadPreview(control, imagePath, "No image uploaded yet.");
        });
    }

    function createCategoryEditor(category = "") {
        const row = document.createElement("div");
        row.className = "admin-repeat-row admin-repeat-row-compact";
        row.innerHTML = `
            <div class="admin-field admin-field-wide">
                <label>Category Name</label>
                <input type="text" data-field="category" value="${escapeHtml(category)}">
            </div>
            <button class="remove-btn" type="button">Remove</button>
        `;

        row.querySelector('[data-field="category"]').addEventListener("input", refreshCategorySelectOptions);
        row.querySelector(".remove-btn").addEventListener("click", () => {
            row.remove();
            refreshCategorySelectOptions();
        });

        return row;
    }

    function createMenuItemEditor(item = {}) {
        const initialImage = item.image || DEFAULT_MENU_IMAGE;
        const availability = String(item.availability || "available");
        const stockQuantity = item.stockQuantity === null || item.stockQuantity === undefined ? "" : Number(item.stockQuantity);
        const safeImage = getSafeImageSrc(initialImage);
        const row = document.createElement("div");
        row.className = "admin-repeat-row";
        row.innerHTML = `
            <div class="admin-field">
                <label>Name</label>
                <input type="text" data-field="name" value="${escapeHtml(item.name || "")}">
            </div>
            <div class="admin-field">
                <label>Price</label>
                <input type="number" data-field="price" value="${item.price || 0}">
            </div>
            <div class="admin-field">
                <label>Category</label>
                <select data-field="category">${buildCategoryOptions(item.category || "")}</select>
            </div>
            <div class="admin-field">
                <label>Status</label>
                <select data-field="availability">
                    <option value="available" ${availability === "available" ? "selected" : ""}>Available</option>
                    <option value="low-stock" ${availability === "low-stock" ? "selected" : ""}>Low Stock</option>
                    <option value="out-of-stock" ${availability === "out-of-stock" ? "selected" : ""}>Out of Stock</option>
                    <option value="hidden" ${availability === "hidden" ? "selected" : ""}>Hidden</option>
                </select>
            </div>
            <div class="admin-field">
                <label>Remaining Quantity</label>
                <input type="number" min="0" step="1" data-field="stockQuantity" value="${stockQuantity}" placeholder="Leave empty for unlimited">
            </div>
            <div class="admin-field admin-field-wide">
                <label>Image</label>
                <div class="admin-image-upload">
                    <input type="text" data-field="image" value="${escapeHtml(safeImage)}" placeholder="Image path will appear here after upload">
                    <div class="admin-upload-tools">
                        <button class="admin-upload-btn" type="button">Upload From Device</button>
                        <input class="admin-upload-input" type="file" accept="image/*" hidden>
                        <span class="admin-upload-status">${safeImage === DEFAULT_MENU_IMAGE ? "Using default placeholder image." : `Saved image: ${escapeHtml(safeImage)}`}</span>
                    </div>
                    <img class="admin-image-preview" src="${escapeHtml(safeImage)}" alt="Menu item preview">
                </div>
            </div>
            <button class="remove-btn" type="button">Remove</button>
        `;

        const imageInputEl = row.querySelector('[data-field="image"]');
        const uploadBtn = row.querySelector(".admin-upload-btn");
        const uploadInputEl = row.querySelector(".admin-upload-input");
        const uploadStatusEl = row.querySelector(".admin-upload-status");

        uploadBtn.addEventListener("click", () => {
            uploadInputEl.click();
        });

        uploadInputEl.addEventListener("change", async () => {
            const selectedFile = uploadInputEl.files && uploadInputEl.files[0];

            if (!selectedFile) {
                return;
            }

            try {
                uploadStatusEl.textContent = "Uploading image...";
                setStatus("Uploading image...", "info");
                const imagePath = await uploadMenuImage(selectedFile);
                imageInputEl.value = imagePath;
                updateMenuItemImagePreview(row, imagePath);
                setStatus("Image uploaded successfully.", "success");
            } catch (error) {
                uploadStatusEl.textContent = error.message;
                setStatus(error.message, "error");
            } finally {
                uploadInputEl.value = "";
            }
        });

        imageInputEl.addEventListener("input", () => {
            updateMenuItemImagePreview(row, imageInputEl.value.trim());
        });

        const availabilityEl = row.querySelector('[data-field="availability"]');
        const stockQuantityEl = row.querySelector('[data-field="stockQuantity"]');
        const syncAvailabilityWithQuantity = () => {
            const quantityValue = stockQuantityEl.value.trim();

            if (!quantityValue) {
                if (availabilityEl.value === "low-stock" || availabilityEl.value === "out-of-stock") {
                    availabilityEl.value = "available";
                }
                return;
            }

            const parsedValue = Math.max(0, Number(quantityValue || 0));

            if (parsedValue === 0) {
                availabilityEl.value = "out-of-stock";
            } else if (parsedValue <= 5 && availabilityEl.value !== "hidden") {
                availabilityEl.value = "low-stock";
            } else if (availabilityEl.value !== "hidden") {
                availabilityEl.value = "available";
            }
        };

        stockQuantityEl.addEventListener("input", syncAvailabilityWithQuantity);

        row.querySelector(".remove-btn").addEventListener("click", () => {
            row.remove();
        });

        updateMenuItemImagePreview(row, safeImage);

        return row;
    }

    function createZoneEditor(zone = {}) {
        const row = document.createElement("div");
        row.className = "admin-repeat-row";
        row.innerHTML = `
            <div class="admin-field">
                <label>Area Label</label>
                <input type="text" data-field="label" value="${escapeHtml(zone.label || "")}">
            </div>
            <div class="admin-field">
                <label>Value</label>
                <input type="text" data-field="value" value="${escapeHtml(zone.value || "")}">
            </div>
            <div class="admin-field">
                <label>Fee</label>
                <input type="number" data-field="fee" value="${zone.fee || 0}">
            </div>
            <button class="remove-btn" type="button">Remove</button>
        `;

        row.querySelector(".remove-btn").addEventListener("click", () => {
            row.remove();
        });

        return row;
    }

    function populateCategoryEditor(categories) {
        categoriesAdminListEl.innerHTML = "";
        categories.forEach((category) => {
            categoriesAdminListEl.appendChild(createCategoryEditor(category));
        });
        refreshCategorySelectOptions();
    }

    function populateMenuEditor(items) {
        menuAdminListEl.innerHTML = "";
        items.forEach((item) => {
            menuAdminListEl.appendChild(createMenuItemEditor(item));
        });
        refreshCategorySelectOptions();
    }

    function populateZoneEditor(zones) {
        zonesAdminListEl.innerHTML = "";
        zones.forEach((zone) => {
            zonesAdminListEl.appendChild(createZoneEditor(zone));
        });
    }

    function collectSiteData() {
        const menuRows = [...menuAdminListEl.children];
        const printerSettings = getPrinterSettings();
        const menuItems = menuRows.map((row, index) => {
            const name = row.querySelector('[data-field="name"]').value.trim();
            const price = Number(row.querySelector('[data-field="price"]').value || 0);
            const category = row.querySelector('[data-field="category"]').value.trim();
            const image = row.querySelector('[data-field="image"]').value.trim();
            const availability = row.querySelector('[data-field="availability"]').value.trim();
            const rawStockQuantity = row.querySelector('[data-field="stockQuantity"]').value.trim();
            const stockQuantity = rawStockQuantity ? Math.max(0, Math.floor(Number(rawStockQuantity))) : null;

            if (!name || !image || !category || price <= 0) {
                throw new Error(`Complete name, price, category, and image for menu item ${index + 1} before saving.`);
            }

            if (rawStockQuantity && (!Number.isFinite(Number(rawStockQuantity)) || Number(rawStockQuantity) < 0)) {
                throw new Error(`Enter a valid remaining quantity for menu item ${index + 1}.`);
            }

            return {
                id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
                name,
                price,
                image,
                category,
                availability,
                stockQuantity
            };
        });

        return {
            site: {
                restaurantName: readInput("site-name"),
                logoPath: siteLogoPathEl.value.trim(),
                heroSlides: heroSlideControls
                    .map((control) => control.pathEl.value.trim())
                    .filter(Boolean)
                    .slice(0, 3),
                openingTime: readInput("site-opening-time"),
                closingTime: readInput("site-closing-time"),
                phone: readInput("site-phone"),
                email: readInput("site-email"),
                location: readInput("site-location"),
                whatsappNumber: readInput("site-whatsapp"),
                heroTitle: readInput("site-hero-title"),
                heroSubtitle: readInput("site-hero-subtitle"),
                printerPaperWidth: printerSettings.paperWidth,
                printerContentWidth: printerSettings.contentWidth,
                printerScale: printerSettings.scale
            },
            categories: getCurrentCategories(),
            menuItems,
            deliveryZones: collectRepeatRows(zonesAdminListEl, (row) => {
                const label = row.querySelector('[data-field="label"]').value.trim();
                const value = row.querySelector('[data-field="value"]').value.trim();
                const fee = Number(row.querySelector('[data-field="fee"]').value || 0);

                if (!label || !value || fee < 0) {
                    return null;
                }

                return {
                    label,
                    value,
                    fee
                };
            })
        };
    }

    function createStatusBadge(status) {
        const normalizedStatus = String(status || "Paid").toLowerCase();
        const badge = document.createElement("span");
        badge.className = `receipt-badge ${normalizedStatus === "dispatched" ? "is-neutral" : "is-success"}`;
        badge.textContent = status || "Paid";
        return badge;
    }

    function resetStaffUserForm() {
        document.getElementById("staff-display-name").value = "";
        document.getElementById("staff-username").value = "";
        document.getElementById("staff-password").value = "";
    }

    function renderUsers(users) {
        staffUsersListEl.innerHTML = "";
        staffUsersEmptyEl.hidden = Boolean(users.length);

        users.forEach((user) => {
            const row = document.createElement("article");
            row.className = "admin-repeat-row admin-user-row";
            row.innerHTML = `
                <div class="admin-user-meta">
                    <strong>${escapeHtml(user.displayName || user.username)} ${user.blocked ? '<span class="admin-block-badge">Blocked</span>' : ""}</strong>
                    <span>@${escapeHtml(user.username)}</span>
                    <small>${user.blocked ? "Blocked from login and order handling" : "Can manage orders and stock updates"}</small>
                </div>
                <div class="admin-order-actions">
                    <button class="admin-action-btn ${user.blocked ? "" : "admin-action-btn-primary"}" type="button">${user.blocked ? "Unblock" : "Block"}</button>
                    <button class="remove-btn" type="button">Delete User</button>
                </div>
            `;

            row.querySelector(".admin-action-btn").addEventListener("click", async () => {
                try {
                    setStatus(`${user.blocked ? "Unblocking" : "Blocking"} ${user.username}...`, "info");
                    const response = await fetchJson("/api/admin/users/block", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            username: user.username,
                            blocked: !user.blocked
                        })
                    });
                    renderUsers(response.users || []);
                    setStatus(response.message || "User status updated successfully.", "success");
                } catch (error) {
                    setStatus(error.message, "error");
                }
            });

            row.querySelector(".remove-btn").addEventListener("click", async () => {
                try {
                    setStatus(`Removing ${user.username}...`, "info");
                    const response = await fetchJson("/api/admin/users/delete", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            username: user.username
                        })
                    });
                    renderUsers(response.users || []);
                    setStatus(`User ${user.username} removed successfully.`, "success");
                } catch (error) {
                    setStatus(error.message, "error");
                }
            });

            staffUsersListEl.appendChild(row);
        });
    }

    function getSalesRangeLabel() {
        const labels = {
            today: "Daily",
            week: "Weekly",
            month: "Monthly",
            all: "All Time"
        };

        return labels[adminSalesRangeEl.value] || "All Time";
    }

    // Sales reporting is item-based because management uses it for closing and stock visibility.
    function renderSalesReport(report) {
        salesReportCache = report;
        adminSalesBodyEl.innerHTML = "";

        if (!report.items.length) {
            adminSalesBodyEl.innerHTML = '<tr><td colspan="3">No item sales in this range.</td></tr>';
        } else {
            report.items.forEach((item) => {
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td>${escapeHtml(item.name)}</td>
                    <td>${escapeHtml(item.quantity)}</td>
                    <td>${formatPrice(item.total)}</td>
                `;
                adminSalesBodyEl.appendChild(row);
            });
        }

        const totalQuantity = (report.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        adminSalesTotalOrdersEl.textContent = String(report.totalOrders || 0);
        adminSalesTotalQuantityEl.textContent = String(totalQuantity);
        adminSalesTotalValueEl.textContent = formatPrice(report.totalItemSales || 0);
        adminSalesFooterTotalEl.textContent = formatPrice(report.totalItemSales || 0);
    }

    function renderClosingHistory(history) {
        adminClosingHistoryEl.innerHTML = "";

        if (!history.length) {
            adminClosingHistoryEl.innerHTML = '<p class="admin-helper-text">No closing history yet.</p>';
            return;
        }

        history.forEach((entry) => {
            const item = document.createElement("div");
            item.className = "admin-monitor-item";
            item.innerHTML = `
                <strong>${escapeHtml(formatDateTime(entry.closedAt))}</strong>
                <span>Orders: ${escapeHtml(entry.totalOrders)}</span>
                <span>Items Sold: ${escapeHtml(entry.totalItemsSold)}</span>
                <span>Total Sales: ${formatPrice(entry.totalItemSales || 0)}</span>
            `;
            adminClosingHistoryEl.appendChild(item);
        });
    }

    function getSalesPrintDocument(report) {
        const rows = (report.items || [])
            .map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.quantity)}</td><td>${formatPrice(item.total)}</td></tr>`)
            .join("");

        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Sales Report</title><style>body{font-family:Poppins,Arial,sans-serif;margin:0;padding:24px;color:#111;background:#fff}.sheet{max-width:820px;margin:0 auto;border:1px solid #ddd;border-radius:16px;padding:24px}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:18px 0}.summary-card{padding:14px;border:1px solid #e5e7eb;border-radius:14px;background:#fafafa}.summary-card strong,.summary-card p{margin:0}.summary-card p{margin-top:6px;font-size:22px;font-weight:700}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{text-align:left;padding:12px 10px;border-bottom:1px solid #e5e7eb}h1,p{margin-top:0}.footer-total{display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding-top:14px;border-top:2px solid #111;font-size:20px;font-weight:700}@media print{body{padding:0}.sheet{border:none;border-radius:0;padding:0}}</style></head><body><div class="sheet"><h1>Sales Report</h1><p>Range: ${getSalesRangeLabel()}</p><div class="summary"><div class="summary-card"><strong>Total Orders</strong><p>${report.totalOrders || 0}</p></div><div class="summary-card"><strong>Total Items Sold</strong><p>${(report.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)}</p></div><div class="summary-card"><strong>Total Item Sales</strong><p>${formatPrice(report.totalItemSales || 0)}</p></div></div><table><thead><tr><th>Item</th><th>Quantity Sold</th><th>Total</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No item sales in this range.</td></tr>'}</tbody></table><div class="footer-total"><span>Total of all item sales</span><span>${formatPrice(report.totalItemSales || 0)}</span></div></div></body></html>`;
    }

    function getClosingSummaryDocument(report) {
        const branding = getSiteBranding();
        const today = new Date().toLocaleString("en-NG", {
            dateStyle: "medium",
            timeStyle: "short"
        });
        const totalQuantity = (report.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const rows = (report.items || [])
            .map((item) => `
                <tr>
                    <td>${escapeHtml(item.name)}</td>
                    <td>${escapeHtml(item.quantity)}</td>
                    <td>${formatPrice(item.total)}</td>
                </tr>
            `)
            .join("");

        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Closing Summary</title><style>@page{size:A4;margin:14mm}body{font-family:Poppins,Arial,sans-serif;margin:0;color:#111;background:#fff} .sheet{max-width:760px;margin:0 auto;border:1px solid #ddd;border-radius:18px;padding:24px 24px 28px} .brand{text-align:center;margin-bottom:16px} .brand h1{margin:0;font-size:28px} .brand p{margin:4px 0 0;color:#475569} .heading{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid #111} .heading h2,.heading p{margin:0} .summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:18px} .summary-card{border:1px solid #e5e7eb;border-radius:16px;padding:14px;background:#fafafa} .summary-card strong,.summary-card p{margin:0} .summary-card p{margin-top:8px;font-size:22px;font-weight:700} table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:12px 10px;border-bottom:1px solid #e5e7eb} .footer-total{display:flex;justify-content:space-between;align-items:center;margin-top:18px;padding-top:14px;border-top:2px solid #111;font-size:22px;font-weight:700} .signoff{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin-top:30px} .signoff p{margin:0 0 34px;color:#64748b} .signoff strong{display:block;padding-top:8px;border-top:1px solid #111} @media print{body{background:#fff}.sheet{border:none;border-radius:0;padding:0}}</style></head><body><div class="sheet"><div class="brand"><h1>${escapeHtml(branding.restaurantName)}</h1>${branding.phone ? `<p>${escapeHtml(branding.phone)}</p>` : ""}${branding.location ? `<p>${escapeHtml(branding.location)}</p>` : ""}</div><div class="heading"><div><h2>Daily Closing Summary</h2><p>Prepared for end-of-day review</p></div><div><strong>${today}</strong></div></div><div class="summary"><div class="summary-card"><strong>Total Orders</strong><p>${report.totalOrders || 0}</p></div><div class="summary-card"><strong>Total Items Sold</strong><p>${totalQuantity}</p></div><div class="summary-card"><strong>Total Item Sales</strong><p>${formatPrice(report.totalItemSales || 0)}</p></div></div><table><thead><tr><th>Item</th><th>Qty</th><th>Total</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No item sales today.</td></tr>'}</tbody></table><div class="footer-total"><span>Total Sales For Today</span><span>${formatPrice(report.totalItemSales || 0)}</span></div><div class="signoff"><div><p>Prepared by</p><strong>________________________</strong></div><div><p>Approved by</p><strong>________________________</strong></div></div></div></body></html>`;
    }

    function openPrintDocument(documentMarkup) {
        const key = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const returnUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        localStorage.setItem(`printDocument:${key}`, documentMarkup);
        window.location.href = `receipt-print.html?key=${encodeURIComponent(key)}&return=${encodeURIComponent(returnUrl)}`;
    }

    function printSalesReport(report) {
        openPrintDocument(getSalesPrintDocument(report));
    }

    function printClosingSummary(report) {
        openPrintDocument(getClosingSummaryDocument(report));
    }

    function buildReceipt(order) {
        const branding = getSiteBranding();
        const safeLogoPath = getSafeImageSrc(branding.logoPath);
        const subtotal = Math.max(0, Number(order.total || 0) - Number(order.deliveryFee || 0) - Number(order.serviceFee || 0));
        const totalItems = (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const fulfillmentLabel = getFulfillmentLabel(order);
        const receiptBranding = `
            <div class="receipt-thermal-brand">
                ${safeLogoPath ? `<img class="receipt-logo receipt-logo-thermal" src="${escapeHtml(safeLogoPath)}" alt="${escapeHtml(branding.restaurantName)}">` : ""}
                <h4>${escapeHtml(branding.restaurantName)}</h4>
                ${branding.phone ? `<p class="receipt-thermal-contact">${escapeHtml(branding.phone)}</p>` : ""}
                ${branding.location ? `<p class="receipt-thermal-contact">${escapeHtml(branding.location)}</p>` : ""}
                <p class="receipt-kicker receipt-kicker-thermal">Order receipt</p>
            </div>
        `;
        const itemsMarkup = (order.items || [])
            .map((item) => `
                <li class="receipt-thermal-item">
                    <span class="receipt-thermal-item-qty">${escapeHtml(item.quantity)}x</span>
                    <span class="receipt-thermal-item-name">${escapeHtml(item.name)}</span>
                    <strong class="receipt-thermal-item-price">${formatPrice(item.price * item.quantity)}</strong>
                </li>
            `)
            .join("");

        return `
            <div class="receipt-pos receipt-pos-thermal">
                ${receiptBranding}
                <div class="receipt-divider receipt-divider-thermal"></div>
                <h5 class="receipt-thermal-title">SALES RECEIPT</h5>
                <div class="receipt-divider receipt-divider-thermal"></div>
                <div class="receipt-thermal-meta">
                    <span>${escapeHtml(order.reference)}</span>
                    <span>${escapeHtml(order.date || "-")}</span>
                </div>
            </div>
            <div class="receipt-thermal-table-head">
                <span>Qty</span>
                <span>Item Description</span>
                <span>Price</span>
            </div>
            <div class="receipt-divider receipt-divider-thermal"></div>
            <div class="receipt-section receipt-section-tight">
                <ul class="receipt-items-list receipt-items-list-thermal">${itemsMarkup}</ul>
            </div>
            <p class="receipt-thermal-count">${escapeHtml(totalItems)} item(s) sold</p>
            <div class="receipt-divider receipt-divider-thermal"></div>
            <div class="receipt-breakdown receipt-breakdown-thermal">
                <p><span>Sub Total:</span><strong>${formatPrice(subtotal)}</strong></p>
                <p><span>Delivery Fee:</span><strong>${formatPrice(order.deliveryFee || 0)}</strong></p>
                <p><span>Service Fee:</span><strong>${formatPrice(order.serviceFee || 0)}</strong></p>
            </div>
            <div class="receipt-divider receipt-divider-thermal"></div>
            <div class="receipt-total-row receipt-total-row-pos receipt-total-row-thermal">
                <span>Total:</span>
                <strong>${formatPrice(order.total || 0)}</strong>
            </div>
            <div class="receipt-thermal-details">
                <p><strong>Type:</strong> <span>${escapeHtml(fulfillmentLabel)}</span></p>
                <p><strong>Phone:</strong> <span>${escapeHtml(order.customerPhone || "-")}</span></p>
                <p><strong>Email:</strong> <span>${escapeHtml(order.email || "-")}</span></p>
                <p><strong>Area:</strong> <span>${escapeHtml(order.deliveryArea || fulfillmentLabel)}</span></p>
                <p><strong>Handled By:</strong> <span>${escapeHtml(order.attendedBy || "Waiting")}</span></p>
                <p><strong>Drop-off:</strong> <span>${escapeHtml(order.deliveryLocation || (fulfillmentLabel === "Pickup" ? "Customer pickup" : "Not provided"))}</span></p>
                <p><strong>Note:</strong> <span>${escapeHtml(order.orderNote || "No special instruction")}</span></p>
            </div>
            <div class="receipt-divider receipt-divider-thermal"></div>
            <p class="receipt-thank-you receipt-thank-you-thermal">THANK YOU</p>
        `;
    }

    function getReceiptPrintDocument(order) {
        const printer = getPrinterSettings();
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Receipt ${escapeHtml(order.reference)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="style.css?v=20260512e"><style>@page{size:${printer.paperWidth}mm 297mm;margin:1mm}body{width:${printer.paperWidth}mm;margin:0 auto;padding:0;background:#fff;color:#111;font-family:Poppins,Arial,sans-serif}.print-shell{width:${printer.contentWidth}mm;margin:0 auto;zoom:${printer.scale}}.print-shell .receipt-card{margin-top:0;padding:5px 5px 3px;border:none;border-radius:0;background:#fcfcfc;box-shadow:none}.print-shell .receipt-pos{width:min(100%,280px);gap:3px;font-size:10px}.print-shell .receipt-logo{width:50px;height:50px;margin:0 auto 3px}.print-shell .receipt-thermal-brand h4{font-size:13px;line-height:1}.print-shell .receipt-thermal-contact{font-size:8px;line-height:1.05}.print-shell .receipt-kicker{margin-top:1px;font-size:8px;letter-spacing:.06em}.print-shell .receipt-divider{margin:3px 0}.print-shell .receipt-thermal-title{font-size:14px;margin:1px 0}.print-shell .receipt-thermal-meta{font-size:8px;gap:3px}.print-shell .receipt-thermal-table-head,.print-shell .receipt-thermal-item{grid-template-columns:24px 1fr auto;gap:4px}.print-shell .receipt-thermal-table-head{font-size:8px}.print-shell .receipt-thermal-item{padding:2px 0;font-size:9px}.print-shell .receipt-thermal-count{margin:3px 0;font-size:9px}.print-shell .receipt-breakdown{gap:1px}.print-shell .receipt-breakdown p{font-size:9px;gap:4px}.print-shell .receipt-total-row{margin-top:3px;padding-top:3px;font-size:12px;gap:4px}.print-shell .receipt-total-row strong{font-size:16px}.print-shell .receipt-thermal-details{gap:1px}.print-shell .receipt-thermal-details p{font-size:8px;gap:3px;line-height:1}.print-shell .receipt-thank-you{margin:4px 0 3px;font-size:12px}.receipt-footer-meta{margin-top:3px;padding-top:3px;border-top:1px dashed #777;display:flex;justify-content:space-between;gap:3px;font-size:7px;font-family:'Courier New',monospace;page-break-inside:avoid}.receipt-footer-meta span:last-child{text-align:right}@media print{body{width:${printer.paperWidth}mm;padding:0}.print-shell{width:${printer.contentWidth}mm;zoom:${printer.scale}}}</style></head><body><div class="print-shell" data-paper-width="${printer.paperWidth}" data-content-width="${printer.contentWidth}" data-print-scale="${printer.scale}"><section class="receipt-card">${buildReceipt(order)}<div class="receipt-footer-meta"><span>${escapeHtml(order.reference)}</span><span>${escapeHtml(order.date || "-")}</span></div></section></div></body></html>`;
    }

    function printOrderReceipt(order) {
        openPrintDocument(getReceiptPrintDocument(order));
    }

    function printPrinterTestReceipt() {
        const printer = getPrinterSettings();
        const now = new Date();
        const testOrder = {
            reference: `TEST-${Date.now()}`,
            date: now.toLocaleString("en-NG", {
                dateStyle: "short",
                timeStyle: "short"
            }),
            customerPhone: "08000000000",
            email: "printer-test@example.com",
            deliveryArea: "Printer setup",
            deliveryLocation: "Counter pickup",
            fulfillmentType: "pickup",
            attendedBy: "Admin test",
            orderNote: `${printer.paperWidth}mm paper, ${printer.contentWidth}mm content, ${Math.round(printer.scale * 100)}% scale`,
            deliveryFee: 0,
            serviceFee: 100,
            items: [
                { name: "Printer test item", quantity: 1, price: 1000 },
                { name: "Long item name fit check", quantity: 1, price: 1500 }
            ],
            total: 2600
        };

        openPrintDocument(getReceiptPrintDocument(testOrder));
    }

    function playNewOrderAlert() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) {
            return;
        }

        const audioContext = new AudioContextClass();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(988, audioContext.currentTime + 0.16);
        gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.16, audioContext.currentTime + 0.03);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.48);
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.5);

        oscillator.onended = () => {
            audioContext.close().catch(() => {
                // Ignore audio cleanup errors.
            });
        };
    }

    function createOrderActions(order) {
        const wrapper = document.createElement("div");
        wrapper.className = "admin-order-actions";

        const printBtn = document.createElement("button");
        printBtn.type = "button";
        printBtn.className = "admin-action-btn";
        printBtn.textContent = "Print Receipt";
        printBtn.addEventListener("click", () => {
            printOrderReceipt(order);
        });

        wrapper.appendChild(printBtn);

        if (isPendingOrder(order)) {
            const dispatchBtn = document.createElement("button");
            dispatchBtn.type = "button";
            dispatchBtn.className = "admin-action-btn admin-action-btn-primary";
            dispatchBtn.textContent = "Dispatch";
            dispatchBtn.addEventListener("click", async () => {
                await updateOrderStatus(order.reference, "Dispatched");
            });
            wrapper.appendChild(dispatchBtn);
        }

        if (isDispatchedOrder(order)) {
            const deliverBtn = document.createElement("button");
            deliverBtn.type = "button";
            deliverBtn.className = "admin-action-btn admin-action-btn-primary";
            deliverBtn.textContent = "Delivered";
            deliverBtn.addEventListener("click", async () => {
                await updateOrderStatus(order.reference, "Delivered");
            });
            wrapper.appendChild(deliverBtn);
        }

        return wrapper;
    }

    function renderNotificationOrders(orders) {
        const pendingOrders = orders.filter(isPendingOrder);
        const pendingCount = pendingOrders.length;

        if (hasLoadedOrdersOnce && pendingCount > previousPendingCount) {
            playNewOrderAlert();
        }

        previousPendingCount = pendingCount;
        hasLoadedOrdersOnce = true;
        adminNotificationCountEl.textContent = String(pendingCount);
        adminNotificationLabelEl.textContent = `${pendingCount} pending`;
        adminNotificationListEl.innerHTML = "";

        if (!pendingOrders.length) {
            adminNotificationListEl.innerHTML = '<p class="admin-notification-empty">No new orders right now.</p>';
            return;
        }

        pendingOrders.forEach((order) => {
            const item = document.createElement("article");
            item.className = "admin-notification-item";
            item.innerHTML = `
                <div class="admin-notification-item-head">
                    <strong>${escapeHtml(order.reference)}</strong>
                    <span>${formatPrice(order.total || 0)}</span>
                </div>
                <p>${escapeHtml(getFulfillmentLabel(order))} • ${escapeHtml(order.customerPhone || "-")} • ${escapeHtml(order.deliveryArea || "-")}</p>
                <small>${escapeHtml(order.date || "-")}</small>
            `;

            const actions = createOrderActions(order);
            item.appendChild(actions);
            adminNotificationListEl.appendChild(item);
        });
    }

    function renderOrders(orders) {
        ordersListEl.innerHTML = "";
        ordersTableBodyEl.innerHTML = "";
        recentOrdersBodyEl.innerHTML = "";

        const pendingOrders = orders.filter(isPendingOrder);
        renderNotificationOrders(orders);

        if (!orders.length) {
            ordersEmptyEl.hidden = false;
            statTotalOrdersEl.textContent = "0";
            statPendingOrdersEl.textContent = "0";
            statTotalRevenueEl.textContent = formatPrice(0);
            return;
        }

        ordersEmptyEl.hidden = true;
        statTotalOrdersEl.textContent = String(orders.length);
        statPendingOrdersEl.textContent = String(pendingOrders.length);
        statTotalRevenueEl.textContent = formatPrice(
            orders.reduce((sum, order) => sum + Number(order.total || 0), 0)
        );

        orders.forEach((order, index) => {
            const itemsText = (order.items || [])
                .map((item) => `${item.name} x${item.quantity}`)
                .join(", ");

            const tableRow = document.createElement("tr");
            const actionCell = document.createElement("td");
            actionCell.appendChild(createOrderActions(order));
            tableRow.innerHTML = `
                <td>${escapeHtml(order.reference)}</td>
                <td>${escapeHtml(order.customerPhone || "-")}<br><small>${escapeHtml(order.attendedBy || "Waiting")}</small></td>
                <td>${escapeHtml(getFulfillmentLabel(order))}<br><small>${escapeHtml(order.deliveryArea || "-")}</small></td>
                <td>${formatPrice(order.total || 0)}</td>
                <td></td>
                <td>${escapeHtml(order.date || "-")}</td>
            `;
            tableRow.children[4].appendChild(createStatusBadge(getOrderStatus(order)));
            tableRow.appendChild(actionCell);
            ordersTableBodyEl.appendChild(tableRow);

            if (index < 5) {
                const recentRow = document.createElement("tr");
                const recentActionCell = document.createElement("td");
                recentActionCell.appendChild(createOrderActions(order));
                recentRow.innerHTML = `
                    <td>${escapeHtml(order.reference)}</td>
                    <td>${escapeHtml(itemsText || "-")}<br><small>${escapeHtml(order.attendedBy || "Waiting")}</small></td>
                    <td>${formatPrice(order.total || 0)}</td>
                    <td></td>
                    <td>${escapeHtml(order.date || "-")}</td>
                `;
                recentRow.children[3].appendChild(createStatusBadge(getOrderStatus(order)));
                recentRow.appendChild(recentActionCell);
                recentOrdersBodyEl.appendChild(recentRow);
            }
        });

        orders.forEach((order) => {
            const itemsMarkup = (order.items || [])
                .map((item) => `
                    <li class="receipt-item-row">
                        <span>${escapeHtml(item.name)} x${escapeHtml(item.quantity)}</span>
                        <strong>${formatPrice(item.price * item.quantity)}</strong>
                    </li>
                `)
                .join("");

            const card = document.createElement("article");
            card.className = "order-card";
            card.id = `order-${String(order.reference || "").replace(/[^a-z0-9_-]+/gi, "-")}`;
            card.innerHTML = `
                <div class="receipt-topline">
                    <div>
                        <p class="receipt-kicker">Paid order</p>
                        <h4>${escapeHtml(order.reference)}</h4>
                    </div>
                </div>
                <div class="receipt-grid">
                    <p><strong>Date:</strong> ${escapeHtml(order.date || "-")}</p>
                    <p><strong>Type:</strong> ${escapeHtml(getFulfillmentLabel(order))}</p>
                    <p><strong>Phone:</strong> ${escapeHtml(order.customerPhone || "-")}</p>
                    <p><strong>Email:</strong> ${escapeHtml(order.email || "-")}</p>
                    <p><strong>Area:</strong> ${escapeHtml(order.deliveryArea || getFulfillmentLabel(order))}</p>
                    <p><strong>Handled By:</strong> ${escapeHtml(order.attendedBy || "Waiting")}</p>
                    <p><strong>Delivery Fee:</strong> ${formatPrice(order.deliveryFee || 0)}</p>
                    <p><strong>Total Paid:</strong> ${formatPrice(order.total || 0)}</p>
                </div>
                <div class="receipt-section">
                    <div class="receipt-section-title">
                        <strong>Items</strong>
                        <span>${escapeHtml((order.items || []).length)} item(s)</span>
                    </div>
                    <ul class="receipt-items-list">${itemsMarkup}</ul>
                </div>
                <div class="receipt-section receipt-meta-box">
                    <p><strong>Drop-off:</strong> ${escapeHtml(order.deliveryLocation || (getFulfillmentLabel(order) === "Pickup" ? "Customer pickup" : "Not provided"))}</p>
                    <p><strong>Order Note:</strong> ${escapeHtml(order.orderNote || "No special instruction")}</p>
                </div>
            `;

            const header = card.querySelector(".receipt-topline");
            header.appendChild(createStatusBadge(getOrderStatus(order)));
            card.appendChild(createOrderActions(order));
            ordersListEl.appendChild(card);
        });
    }

    function renderNotificationOrders(orders) {
        const pendingOrders = orders.filter(isPendingOrder);
        const pendingCount = pendingOrders.length;

        if (hasLoadedOrdersOnce && pendingCount > previousPendingCount) {
            playNewOrderAlert();
        }

        previousPendingCount = pendingCount;
        hasLoadedOrdersOnce = true;
        adminNotificationCountEl.textContent = String(pendingCount);
        adminNotificationLabelEl.textContent = `${pendingCount} pending`;
        adminNotificationListEl.innerHTML = "";

        if (!pendingOrders.length) {
            adminNotificationListEl.innerHTML = '<p class="admin-notification-empty">No new orders right now.</p>';
            return;
        }

        pendingOrders.forEach((order) => {
            const item = document.createElement("article");
            item.className = "admin-notification-item";
            item.innerHTML = `
                <div class="admin-notification-item-head">
                    <strong>${escapeHtml(order.reference)}</strong>
                    <span>${formatPrice(order.total || 0)}</span>
                </div>
                <p>${escapeHtml(getFulfillmentLabel(order))} • ${escapeHtml(order.customerPhone || "-")} • ${escapeHtml(order.deliveryArea || "-")}</p>
                <small>${escapeHtml(order.date || "-")}</small>
            `;

            const actions = createOrderActions(order);
            item.appendChild(actions);
            adminNotificationListEl.appendChild(item);
        });
    }

    async function updateOrderStatus(reference, status) {
        try {
            setStatus(`Updating ${reference}...`, "info");

            await fetchJson("/api/orders/status", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    reference,
                    status
                })
            });

            setStatus(`Order ${reference} marked as ${status}.`, "success");
            await loadOrders();
        } catch (error) {
            setStatus(error.message, "error");
        }
    }

    async function loadOrders() {
        const data = await fetchJson("/api/orders");
        ordersCache = data.orders || [];
        renderOrders(ordersCache);
        return ordersCache;
    }

    async function loadSiteData() {
        const siteData = await fetchJson("/api/site-data");
        populateSiteSettings(siteData.site || {});
        populateCategoryEditor(siteData.categories || []);
        populateMenuEditor(siteData.menuItems || []);
        populateZoneEditor(siteData.deliveryZones || []);
    }

    async function loadUsers() {
        const data = await fetchJson("/api/admin/users");
        renderUsers(data.users || []);
        return data.users || [];
    }

    async function loadSalesReport() {
        const range = adminSalesRangeEl.value || "today";
        const data = await fetchJson(`/api/admin/sales-report?range=${encodeURIComponent(range)}`);
        renderSalesReport(data.report || salesReportCache);
        return data.report || salesReportCache;
    }

    async function loadClosingHistory() {
        const data = await fetchJson("/api/admin/closing-history");
        renderClosingHistory(data.history || []);
        return data.history || [];
    }

    function renderBackups(backups) {
        backupListEl.innerHTML = "";

        if (!backups.length) {
            backupListEl.innerHTML = '<p class="admin-helper-text">No database backups yet.</p>';
            return;
        }

        backups.slice(0, 8).forEach((backup) => {
            const item = document.createElement("div");
            item.className = "admin-monitor-item";
            item.innerHTML = `
                <strong>${escapeHtml(backup.fileName)}</strong>
                <span>${escapeHtml(formatDateTime(backup.createdAt))}</span>
                <span>${escapeHtml(backup.path)}</span>
            `;
            backupListEl.appendChild(item);
        });
    }

    function renderLogs(logs) {
        logListEl.innerHTML = "";

        if (!logs.length) {
            logListEl.innerHTML = '<p class="admin-helper-text">No recent server logs yet.</p>';
            return;
        }

        logs.slice(0, 12).forEach((entry) => {
            const item = document.createElement("div");
            item.className = `admin-monitor-item admin-log-item is-${String(entry.level || "info").toLowerCase()}`;
            item.innerHTML = `
                <strong>${escapeHtml(String(entry.level || "info").toUpperCase())}</strong>
                <span>${escapeHtml(formatDateTime(entry.time))}</span>
                <span>${escapeHtml(entry.message || "-")}</span>
            `;
            logListEl.appendChild(item);
        });
    }

    async function loadMonitoring() {
        const [backupData, logData] = await Promise.all([
            fetchJson("/api/admin/backups"),
            fetchJson("/api/admin/logs")
        ]);

        renderBackups(backupData.backups || []);
        renderLogs(logData.logs || []);
    }

    async function refreshDashboard() {
        try {
            setStatus("Loading dashboard...", "info");
            await Promise.all([loadSiteData(), loadOrders(), loadMonitoring(), loadUsers(), loadSalesReport(), loadClosingHistory()]);
            setStatus("Dashboard is up to date.", "success");
        } catch (error) {
            setStatus(error.message, "error");
        }
    }

    async function autoRefreshOrders() {
        if (isAutoRefreshing || document.hidden) {
            return;
        }

        // Background refresh keeps the live operations view current without forcing a full dashboard reload.
        isAutoRefreshing = true;

        try {
            await Promise.all([loadOrders(), loadSalesReport()]);
        } catch (error) {
            // Keep background refresh silent unless the page is actively being used.
        } finally {
            isAutoRefreshing = false;
        }
    }

    function startAutoRefresh() {
        if (autoRefreshTimerId) {
            window.clearInterval(autoRefreshTimerId);
        }

        autoRefreshTimerId = window.setInterval(() => {
            autoRefreshOrders();
        }, 5000);
    }

    async function checkSession() {
        try {
            const data = await fetchJson("/api/admin/session");

            if (!data.hasAdminCredentials || !data.isAuthenticated) {
                window.location.href = "admin-login.html";
                return;
            }

            showDashboard();
            refreshDashboard();
        } catch (error) {
            setStatus(error.message, "error");
        }
    }

    adminNotificationBtn.addEventListener("click", () => {
        const isHidden = adminNotificationPanelEl.hidden;
        adminNotificationPanelEl.hidden = !isHidden;
    });

    document.addEventListener("click", (event) => {
        const wrap = event.target.closest(".admin-notification-wrap");

        if (!wrap) {
            adminNotificationPanelEl.hidden = true;
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            autoRefreshOrders();
        }
    });

    adminLogoutBtn.addEventListener("click", async () => {
        try {
            await fetchJson("/api/admin/logout", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                }
            });
        } catch (error) {
            // Ignore and still reset the UI.
        }

        ordersListEl.innerHTML = "";
        ordersEmptyEl.hidden = true;
        ordersTableBodyEl.innerHTML = "";
        recentOrdersBodyEl.innerHTML = "";
        adminNotificationListEl.innerHTML = "";
        menuAdminListEl.innerHTML = "";
        categoriesAdminListEl.innerHTML = "";
        zonesAdminListEl.innerHTML = "";
        window.location.href = "admin-login.html";
    });

    refreshOrdersBtn.addEventListener("click", refreshDashboard);
    dashboardRefreshBtn.addEventListener("click", refreshDashboard);
    refreshMonitoringBtn.addEventListener("click", async () => {
        try {
            setStatus("Refreshing backups and logs...", "info");
            await loadMonitoring();
            setStatus("Backups and logs are up to date.", "success");
        } catch (error) {
            setStatus(error.message, "error");
        }
    });

    siteLogoUploadBtn.addEventListener("click", () => {
        siteLogoUploadInputEl.click();
    });

    siteLogoUploadInputEl.addEventListener("change", async () => {
        const selectedFile = siteLogoUploadInputEl.files && siteLogoUploadInputEl.files[0];

        if (!selectedFile) {
            return;
        }

        try {
            siteLogoUploadStatusEl.textContent = "Uploading logo...";
            setStatus("Uploading logo...", "info");
            const imagePath = await uploadMenuImage(selectedFile);
            siteLogoPathEl.value = imagePath;
            updateSiteLogoPreview(imagePath);
            setStatus("Logo uploaded successfully.", "success");
        } catch (error) {
            siteLogoUploadStatusEl.textContent = error.message;
            setStatus(error.message, "error");
        } finally {
            siteLogoUploadInputEl.value = "";
        }
    });

    siteLogoPathEl.addEventListener("input", () => {
        updateSiteLogoPreview(siteLogoPathEl.value.trim());
    });

    heroSlideControls.forEach((control) => {
        control.uploadBtn.addEventListener("click", () => {
            control.uploadInputEl.click();
        });

        control.uploadInputEl.addEventListener("change", async () => {
            const selectedFile = control.uploadInputEl.files && control.uploadInputEl.files[0];

            if (!selectedFile) {
                return;
            }

            try {
                control.uploadStatusEl.textContent = `Uploading ${control.label}...`;
                setStatus(`Uploading ${control.label}...`, "info");
                const imagePath = await uploadMenuImage(selectedFile);
                control.pathEl.value = imagePath;
                updateUploadPreview(control, imagePath, "No image uploaded yet.");
                setStatus(`${control.label.charAt(0).toUpperCase()}${control.label.slice(1)} uploaded successfully.`, "success");
            } catch (error) {
                control.uploadStatusEl.textContent = error.message;
                setStatus(error.message, "error");
            } finally {
                control.uploadInputEl.value = "";
            }
        });

        control.pathEl.addEventListener("input", () => {
            updateUploadPreview(control, control.pathEl.value.trim(), "No image uploaded yet.");
        });
    });

    adminNavButtons.forEach((button) => {
        button.addEventListener("click", () => {
            setActiveSection(button.dataset.section);
        });
    });

    createStaffUserBtn.addEventListener("click", async () => {
        try {
            const displayName = readInput("staff-display-name");
            const username = readInput("staff-username");
            const password = document.getElementById("staff-password").value.trim();

            if (!displayName || !username || !password) {
                throw new Error("Enter full name, username, and password for the new user.");
            }

            setStatus("Creating user...", "info");
            const response = await fetchJson("/api/admin/users", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    displayName,
                    username,
                    password
                })
            });

            renderUsers(response.users || []);
            resetStaffUserForm();
            setStatus(response.message || "User created successfully.", "success");
        } catch (error) {
            setStatus(error.message, "error");
        }
    });

    adminSalesRangeEl.addEventListener("change", async () => {
        try {
            setStatus("Loading sales report...", "info");
            await loadSalesReport();
            setStatus("Sales report is up to date.", "success");
        } catch (error) {
            setStatus(error.message, "error");
        }
    });

    adminSalesRefreshBtn.addEventListener("click", async () => {
        try {
            setStatus("Refreshing sales report...", "info");
            await loadSalesReport();
            setStatus("Sales report is up to date.", "success");
        } catch (error) {
            setStatus(error.message, "error");
        }
    });

    adminSalesPrintBtn.addEventListener("click", () => {
        printSalesReport(salesReportCache);
    });

    adminSalesDownloadBtn.addEventListener("click", () => {
        printSalesReport(salesReportCache);
    });

    printerPaperWidthEl.addEventListener("change", syncPrinterContentLimit);

    printerTestBtn.addEventListener("click", () => {
        syncPrinterContentLimit();
        printPrinterTestReceipt();
    });

    adminSalesClosingBtn.addEventListener("click", async () => {
        try {
            setStatus("Preparing daily closing summary...", "info");
            const data = await fetchJson("/api/admin/close-day", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                }
            });
            const todayReport = data.report || salesReportCache;
            printClosingSummary(todayReport);
            await Promise.all([loadOrders(), loadSalesReport(), loadClosingHistory()]);
            setStatus(data.message || "Daily closing summary is ready.", "success");
        } catch (error) {
            setStatus(error.message, "error");
        }
    });

    saveSiteDataBtn.addEventListener("click", async () => {
        try {
            setStatus("Saving changes...", "info");
            const payload = collectSiteData();

            await fetchJson("/api/site-data", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            setStatus("Website settings saved successfully.", "success");
            await loadSiteData();
        } catch (error) {
            setStatus(error.message, "error");
        }
    });

    backupDatabaseBtn.addEventListener("click", async () => {
        try {
            setStatus("Creating database backup...", "info");
            const response = await fetchJson("/api/admin/backup", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                }
            });
            const backupPath = response.backup && response.backup.path ? response.backup.path : "";
            await loadMonitoring();
            setStatus(`Backup created successfully${backupPath ? `: ${backupPath}` : "."}`, "success");
        } catch (error) {
            setStatus(error.message, "error");
        }
    });

    addMenuItemBtn.addEventListener("click", () => {
        menuAdminListEl.appendChild(createMenuItemEditor());
    });

    addCategoryBtn.addEventListener("click", () => {
        categoriesAdminListEl.appendChild(createCategoryEditor());
        refreshCategorySelectOptions();
    });

    addZoneBtn.addEventListener("click", () => {
        zonesAdminListEl.appendChild(createZoneEditor());
    });

    setActiveSection("dashboard");
    checkSession();
    startAutoRefresh();
});
