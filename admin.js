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
    const adminNavButtons = [...document.querySelectorAll(".admin-nav-btn")];
    const adminSections = [...document.querySelectorAll(".admin-section")];
    const statTotalOrdersEl = document.getElementById("stat-total-orders");
    const statPendingOrdersEl = document.getElementById("stat-pending-orders");
    const statTotalRevenueEl = document.getElementById("stat-total-revenue");
    const backupListEl = document.getElementById("backup-list");
    const logListEl = document.getElementById("log-list");

    let ordersCache = [];
    let previousPendingCount = 0;
    let hasLoadedOrdersOnce = false;

    function getSiteBranding() {
        return {
            restaurantName: readInput("site-name") || "My Restaurant",
            logoPath: readInput("site-logo-path") || ""
        };
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

    async function fetchJson(url, options) {
        const response = await fetch(url, options);
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
                heroSubtitle: readInput("site-hero-subtitle")
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

    function buildOrderReceiptMarkup(order) {
        const branding = getSiteBranding();
        const safeLogoPath = getSafeImageSrc(branding.logoPath);
        const logoMarkup = safeLogoPath
            ? `<img src="${escapeHtml(safeLogoPath)}" alt="${escapeHtml(branding.restaurantName)}" style="width:64px;height:64px;object-fit:cover;border-radius:16px;border:1px solid #ddd;">`
            : "";
        const itemsMarkup = (order.items || [])
            .map((item) => `
                <tr>
                    <td>${escapeHtml(item.name)}</td>
                    <td>x${escapeHtml(item.quantity)}</td>
                    <td>${formatPrice(item.price * item.quantity)}</td>
                </tr>
            `)
            .join("");

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>Kitchen Receipt</title>
                <style>
                    body { font-family: Arial, sans-serif; color: #111; margin: 24px; }
                    h1, h2, p { margin: 0 0 8px; }
                    .topline { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
                    .badge { padding: 6px 10px; border-radius: 999px; background: #dcfce7; color: #166534; font-weight: bold; font-size: 12px; }
                    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 18px; margin: 18px 0; }
                    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
                    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #ddd; }
                    .note-box { margin-top: 18px; padding: 12px; border: 1px solid #ddd; border-radius: 10px; }
                    .total { margin-top: 16px; font-size: 20px; font-weight: bold; }
                </style>
            </head>
            <body>
                <div class="topline">
                    <div>
                        <div style="display:flex;align-items:center;gap:14px;">
                            ${logoMarkup}
                            <div>
                                <h1>${escapeHtml(branding.restaurantName)}</h1>
                                <p>Order Receipt</p>
                            </div>
                        </div>
                    </div>
                    <span class="badge">${escapeHtml(order.status || "Paid")}</span>
                </div>
                <p>${escapeHtml(order.reference)}</p>
                <div class="grid">
                    <p><strong>Date:</strong> ${escapeHtml(order.date || "-")}</p>
                    <p><strong>Phone:</strong> ${escapeHtml(order.customerPhone || "-")}</p>
                    <p><strong>Email:</strong> ${escapeHtml(order.email || "-")}</p>
                    <p><strong>Area:</strong> ${escapeHtml(order.deliveryArea || "-")}</p>
                    <p><strong>Delivery Fee:</strong> ${formatPrice(order.deliveryFee || 0)}</p>
                    <p><strong>Service Fee:</strong> ${formatPrice(order.serviceFee || 0)}</p>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Qty</th>
                            <th>Amount</th>
                        </tr>
                    </thead>
                    <tbody>${itemsMarkup}</tbody>
                </table>
                <div class="note-box">
                    <p><strong>Drop-off:</strong> ${escapeHtml(order.deliveryLocation || "Not provided")}</p>
                    <p><strong>Order Note:</strong> ${escapeHtml(order.orderNote || "No special instruction")}</p>
                </div>
                <p class="total">Total Paid: ${formatPrice(order.total || 0)}</p>
            </body>
            </html>
        `;
    }

    function printOrderReceipt(order) {
        const receiptWindow = window.open("", "_blank", "width=900,height=700");

        if (!receiptWindow) {
            setStatus("Allow popups in the browser to print receipts.", "error");
            return;
        }

        receiptWindow.document.open();
        receiptWindow.document.write(buildOrderReceiptMarkup(order));
        receiptWindow.document.close();
        receiptWindow.focus();
        receiptWindow.print();
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
                <p>${order.customerPhone || "-"} • ${order.deliveryArea || "-"}</p>
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
                <td>${escapeHtml(order.customerPhone || "-")}</td>
                <td>${escapeHtml(order.deliveryArea || "-")}</td>
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
                    <td>${escapeHtml(itemsText || "-")}</td>
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
                    <p><strong>Phone:</strong> ${escapeHtml(order.customerPhone || "-")}</p>
                    <p><strong>Email:</strong> ${escapeHtml(order.email || "-")}</p>
                    <p><strong>Area:</strong> ${escapeHtml(order.deliveryArea || "-")}</p>
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
                    <p><strong>Drop-off:</strong> ${escapeHtml(order.deliveryLocation || "Not provided")}</p>
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
                <p>${escapeHtml(order.customerPhone || "-")} • ${escapeHtml(order.deliveryArea || "-")}</p>
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
            await Promise.all([loadSiteData(), loadOrders(), loadMonitoring()]);
            setStatus("Dashboard is up to date.", "success");
        } catch (error) {
            setStatus(error.message, "error");
        }
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
});
