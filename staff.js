document.addEventListener("DOMContentLoaded", () => {
    const staffDashboardEl = document.getElementById("staff-dashboard");
    const staffStatusEl = document.getElementById("staff-status");
    const staffPageTitleEl = document.getElementById("staff-page-title");
    const staffUserPillEl = document.getElementById("staff-user-pill");
    const staffNotificationBtn = document.getElementById("staff-notification-btn");
    const staffNotificationCountEl = document.getElementById("staff-notification-count");
    const staffNotificationLabelEl = document.getElementById("staff-notification-label");
    const staffNotificationPanelEl = document.getElementById("staff-notification-panel");
    const staffNotificationListEl = document.getElementById("staff-notification-list");
    const staffRefreshBtn = document.getElementById("staff-refresh-btn");
    const staffLogoutBtn = document.getElementById("staff-logout-btn");
    const staffOrdersBodyEl = document.getElementById("staff-orders-body");
    const staffOrdersEmptyEl = document.getElementById("staff-orders-empty");
    const staffStockListEl = document.getElementById("staff-stock-list");
    const staffNavButtons = [...document.querySelectorAll(".admin-nav-btn")];
    const staffSections = [...document.querySelectorAll(".admin-section")];

    let ordersCache = [];
    let siteDataCache = null;
    let previousPendingCount = 0;
    let hasLoadedOrdersOnce = false;
    let autoRefreshTimerId = null;
    let isAutoRefreshing = false;
    let audioPrimed = false;
    let stockEditHoldUntil = 0;

    function formatPrice(amount) {
        return `\u20A6${Number(amount || 0)}`;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
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
        staffStatusEl.textContent = message;
        staffStatusEl.className = `payment-status ${type}`;
    }

    function markStockEditing() {
        stockEditHoldUntil = Date.now() + 15000;
    }

    function clearStockEditing() {
        stockEditHoldUntil = 0;
    }

    function isStockEditingLocked() {
        return Date.now() < stockEditHoldUntil;
    }

    function setActiveSection(sectionName) {
        const titles = {
            orders: "Orders Queue",
            stock: "Stock Control"
        };

        staffNavButtons.forEach((button) => {
            button.classList.toggle("is-active", button.dataset.section === sectionName);
        });

        staffSections.forEach((section) => {
            section.classList.toggle("is-active", section.id === `staff-section-${sectionName}`);
        });

        staffPageTitleEl.textContent = titles[sectionName] || "Staff Dashboard";
    }

    function createStatusBadge(status) {
        const normalizedStatus = String(status || "Paid").toLowerCase();
        const badge = document.createElement("span");
        badge.className = `receipt-badge ${normalizedStatus === "dispatched" ? "is-neutral" : "is-success"}`;
        badge.textContent = status || "Paid";
        return badge;
    }

    function isPendingOrder(order) {
        return String(order.status || "Paid").toLowerCase() === "paid";
    }

    function isDispatchedOrder(order) {
        return String(order.status || "Paid").toLowerCase() === "dispatched";
    }

    function getFulfillmentLabel(order) {
        return order && order.fulfillmentType === "pickup" ? "Pickup" : "Delivery";
    }

    function playNewOrderAlert() {
        if (!audioPrimed && !(navigator.userActivation && navigator.userActivation.hasBeenActive)) {
            return;
        }

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) {
            return;
        }

        const audioContext = new AudioContextClass();
        const masterGain = audioContext.createGain();
        masterGain.connect(audioContext.destination);
        masterGain.gain.setValueAtTime(0.0001, audioContext.currentTime);
        masterGain.gain.exponentialRampToValueAtTime(0.48, audioContext.currentTime + 0.03);
        masterGain.gain.exponentialRampToValueAtTime(0.34, audioContext.currentTime + 0.18);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 2.7);

        [
            { start: 0, frequency: 988, type: "square", duration: 0.18, gain: 1.15 },
            { start: 0.2, frequency: 1318, type: "square", duration: 0.2, gain: 1.1 },
            { start: 0.46, frequency: 988, type: "square", duration: 0.18, gain: 1.15 },
            { start: 0.66, frequency: 1318, type: "square", duration: 0.2, gain: 1.1 },
            { start: 1.02, frequency: 1046, type: "sawtooth", duration: 0.22, gain: 1 },
            { start: 1.28, frequency: 1396, type: "square", duration: 0.22, gain: 1.08 },
            { start: 1.62, frequency: 988, type: "square", duration: 0.18, gain: 1.15 },
            { start: 1.82, frequency: 1318, type: "square", duration: 0.2, gain: 1.1 },
            { start: 2.08, frequency: 1567, type: "square", duration: 0.24, gain: 1.05 }
        ].forEach((tone) => {
            const oscillator = audioContext.createOscillator();
            const toneGain = audioContext.createGain();
            oscillator.type = tone.type;
            oscillator.frequency.setValueAtTime(tone.frequency, audioContext.currentTime + tone.start);
            toneGain.gain.setValueAtTime(0.0001, audioContext.currentTime + tone.start);
            toneGain.gain.exponentialRampToValueAtTime(tone.gain, audioContext.currentTime + tone.start + 0.02);
            toneGain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + tone.start + tone.duration);
            oscillator.connect(toneGain);
            toneGain.connect(masterGain);
            oscillator.start(audioContext.currentTime + tone.start);
            oscillator.stop(audioContext.currentTime + tone.start + tone.duration);
        });

        window.setTimeout(() => {
            audioContext.close().catch(() => {
                // Ignore audio cleanup errors.
            });
        }, 3100);
    }

    function primeAudio() {
        audioPrimed = true;
    }

    function buildReceipt(order) {
        const branding = siteDataCache && siteDataCache.site ? siteDataCache.site : {};
        const safeLogoPath = String(branding.logoPath || "").trim();
        const subtotal = Math.max(0, Number(order.total || 0) - Number(order.deliveryFee || 0) - Number(order.serviceFee || 0));
        const totalItems = (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const fulfillmentLabel = getFulfillmentLabel(order);
        const receiptBranding = `
            <div class="receipt-thermal-brand">
                ${safeLogoPath ? `<img class="receipt-logo receipt-logo-thermal" src="${escapeHtml(safeLogoPath)}" alt="${escapeHtml(branding.restaurantName || "Restaurant")}">` : ""}
                <h4>${escapeHtml(branding.restaurantName || "My Restaurant")}</h4>
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
                    <span>${escapeHtml(order.reference || "-")}</span>
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
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Receipt ${escapeHtml(order.reference || "-")}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="style.css?v=20260512e"><style>@page{size:80mm auto;margin:1mm}body{margin:0;padding:0;background:#fff;color:#111;font-family:Poppins,Arial,sans-serif}.print-shell{width:72mm;margin:0 auto;zoom:.9}.print-shell .receipt-card{margin-top:0;padding:5px 5px 3px;border:none;border-radius:0;background:#fcfcfc;box-shadow:none}.print-shell .receipt-pos{width:min(100%,280px);gap:3px;font-size:10px}.print-shell .receipt-logo{width:50px;height:50px;margin:0 auto 3px}.print-shell .receipt-thermal-brand h4{font-size:13px;line-height:1}.print-shell .receipt-thermal-contact{font-size:8px;line-height:1.05}.print-shell .receipt-kicker{margin-top:1px;font-size:8px;letter-spacing:.06em}.print-shell .receipt-divider{margin:3px 0}.print-shell .receipt-thermal-title{font-size:14px;margin:1px 0}.print-shell .receipt-thermal-meta{font-size:8px;gap:3px}.print-shell .receipt-thermal-table-head,.print-shell .receipt-thermal-item{grid-template-columns:24px 1fr auto;gap:4px}.print-shell .receipt-thermal-table-head{font-size:8px}.print-shell .receipt-thermal-item{padding:2px 0;font-size:9px}.print-shell .receipt-thermal-count{margin:3px 0;font-size:9px}.print-shell .receipt-breakdown{gap:1px}.print-shell .receipt-breakdown p{font-size:9px;gap:4px}.print-shell .receipt-total-row{margin-top:3px;padding-top:3px;font-size:12px;gap:4px}.print-shell .receipt-total-row strong{font-size:16px}.print-shell .receipt-thermal-details{gap:1px}.print-shell .receipt-thermal-details p{font-size:8px;gap:3px;line-height:1}.print-shell .receipt-thank-you{margin:4px 0 3px;font-size:12px}.receipt-footer-meta{margin-top:3px;padding-top:3px;border-top:1px dashed #777;display:flex;justify-content:space-between;gap:3px;font-size:7px;font-family:'Courier New',monospace;page-break-inside:avoid}.receipt-footer-meta span:last-child{text-align:right}@media print{body{padding:0}.print-shell{width:72mm;zoom:.9}}</style></head><body><div class="print-shell"><section class="receipt-card">${buildReceipt(order)}<div class="receipt-footer-meta"><span>${escapeHtml(order.reference || "-")}</span><span>${escapeHtml(order.date || "-")}</span></div></section></div></body></html>`;
    }

    function printReceipt(order) {
        const frame = document.createElement("iframe");
        frame.style.position = "fixed";
        frame.style.width = "0";
        frame.style.height = "0";
        frame.style.border = "0";
        document.body.appendChild(frame);

        frame.onload = () => {
            const frameWindow = frame.contentWindow;

            if (frameWindow) {
                frameWindow.focus();
                frameWindow.print();
            }

            window.setTimeout(() => {
                frame.remove();
            }, 1200);
        };

        frame.srcdoc = getReceiptPrintDocument(order);
    }

    async function updateOrderStatus(reference, status) {
        try {
            setStatus(`Updating ${reference}...`, "info");
            await fetchJson("/api/staff/orders/status", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ reference, status })
            });
            await loadDashboard();
            setStatus(`Order ${reference} marked as ${status}.`, "success");
        } catch (error) {
            setStatus(error.message, "error");
        }
    }

    function createOrderActions(order) {
        const wrapper = document.createElement("div");
        wrapper.className = "admin-order-actions";

        const printBtn = document.createElement("button");
        printBtn.type = "button";
        printBtn.className = "admin-action-btn";
        printBtn.textContent = "Print Receipt";
        printBtn.addEventListener("click", () => {
            printReceipt(order);
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
        staffNotificationCountEl.textContent = String(pendingCount);
        staffNotificationLabelEl.textContent = `${pendingCount} pending`;
        staffNotificationListEl.innerHTML = "";

        if (!pendingOrders.length) {
            staffNotificationListEl.innerHTML = '<p class="admin-notification-empty">No new orders right now.</p>';
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
                <p>${escapeHtml(getFulfillmentLabel(order))} - ${escapeHtml(order.customerPhone || "-")} - ${escapeHtml(order.deliveryArea || "-")}</p>
                <small>${escapeHtml(order.date || "-")}</small>
            `;

            item.appendChild(createOrderActions(order));
            staffNotificationListEl.appendChild(item);
        });
    }

    function renderOrders(orders) {
        staffOrdersBodyEl.innerHTML = "";
        staffOrdersEmptyEl.hidden = Boolean(orders.length);
        renderNotificationOrders(orders);

        orders.forEach((order) => {
            const row = document.createElement("tr");
            const actionCell = document.createElement("td");
            actionCell.appendChild(createOrderActions(order));
            row.innerHTML = `
                <td>${escapeHtml(order.reference || "-")}</td>
                <td>${escapeHtml(order.customerPhone || "-")}<br><small>${escapeHtml(order.attendedBy || "Waiting")}</small></td>
                <td>${escapeHtml(getFulfillmentLabel(order))}<br><small>${escapeHtml(order.deliveryArea || "-")}</small></td>
                <td>${formatPrice(order.total || 0)}</td>
                <td></td>
                <td>${escapeHtml(order.date || "-")}</td>
            `;
            row.children[4].appendChild(createStatusBadge(order.status || "Paid"));
            row.appendChild(actionCell);
            staffOrdersBodyEl.appendChild(row);
        });
    }

    async function saveStock(itemId, row) {
        try {
            const availability = row.querySelector('[data-field="availability"]').value.trim();
            const stockQuantity = row.querySelector('[data-field="stockQuantity"]').value.trim();

            if (stockQuantity && (!Number.isFinite(Number(stockQuantity)) || Number(stockQuantity) < 0)) {
                throw new Error("Enter a valid remaining quantity before saving.");
            }

            markStockEditing();
            setStatus(`Saving stock for ${itemId}...`, "info");
            await fetchJson("/api/staff/menu-stock", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    itemId,
                    availability,
                    stockQuantity
                })
            });

            clearStockEditing();
            await loadDashboard();
            setStatus("Stock updated successfully.", "success");
        } catch (error) {
            setStatus(error.message, "error");
        }
    }

    function renderStock(menuItems) {
        staffStockListEl.innerHTML = "";

        menuItems.forEach((item) => {
            const quantityValue = item.stockQuantity === null || item.stockQuantity === undefined ? "" : Number(item.stockQuantity);
            const row = document.createElement("article");
            row.className = "admin-repeat-row";
            row.innerHTML = `
                <div class="admin-user-meta">
                    <strong>${escapeHtml(item.name)}</strong>
                    <span>${formatPrice(item.price || 0)} - ${escapeHtml(item.category || "-")}</span>
                </div>
                <div class="admin-field">
                    <label>Status</label>
                    <select data-field="availability">
                        <option value="available" ${item.availability === "available" ? "selected" : ""}>Available</option>
                        <option value="low-stock" ${item.availability === "low-stock" ? "selected" : ""}>Low Stock</option>
                        <option value="out-of-stock" ${item.availability === "out-of-stock" ? "selected" : ""}>Out of Stock</option>
                        <option value="hidden" ${item.availability === "hidden" ? "selected" : ""}>Hidden</option>
                    </select>
                </div>
                <div class="admin-field">
                    <label>Remaining Quantity</label>
                    <input type="number" min="0" step="1" data-field="stockQuantity" value="${quantityValue}" placeholder="Unlimited">
                </div>
                <button class="admin-action-btn admin-action-btn-primary" type="button">Save Stock</button>
            `;

            const availabilityEl = row.querySelector('[data-field="availability"]');
            const stockQuantityEl = row.querySelector('[data-field="stockQuantity"]');
            const syncAvailabilityWithQuantity = () => {
                const quantityValueRaw = stockQuantityEl.value.trim();

                if (!quantityValueRaw) {
                    if (availabilityEl.value === "low-stock" || availabilityEl.value === "out-of-stock") {
                        availabilityEl.value = "available";
                    }
                    return;
                }

                const parsedValue = Math.max(0, Number(quantityValueRaw || 0));

                if (parsedValue === 0) {
                    availabilityEl.value = "out-of-stock";
                } else if (parsedValue <= 5 && availabilityEl.value !== "hidden") {
                    availabilityEl.value = "low-stock";
                } else if (availabilityEl.value !== "hidden") {
                    availabilityEl.value = "available";
                }
            };

            stockQuantityEl.addEventListener("input", syncAvailabilityWithQuantity);
            stockQuantityEl.addEventListener("input", markStockEditing);
            stockQuantityEl.addEventListener("focus", markStockEditing);
            availabilityEl.addEventListener("change", () => {
                markStockEditing();
                if (availabilityEl.value === "hidden") {
                    return;
                }

                syncAvailabilityWithQuantity();
            });

            row.querySelector("button").addEventListener("click", async () => {
                await saveStock(item.id, row);
            });

            staffStockListEl.appendChild(row);
        });
    }

    async function loadDashboard(options = {}) {
        const shouldRenderStock = options.renderStock !== false;
        const data = await fetchJson("/api/staff/bootstrap");
        ordersCache = data.orders || [];
        siteDataCache = data.siteData || null;
        staffUserPillEl.textContent = data.user && data.user.displayName ? data.user.displayName : "Staff";
        renderOrders(ordersCache);

        if (shouldRenderStock) {
            renderStock((siteDataCache && siteDataCache.menuItems) || []);
        }
    }

    async function autoRefreshDashboard() {
        if (isAutoRefreshing || document.hidden) {
            return;
        }

        // Orders keep refreshing in the background, but stock rows pause while a staff member is typing.
        isAutoRefreshing = true;

        try {
            await loadDashboard({
                renderStock: !isStockEditingLocked()
            });
        } catch (error) {
            // Keep background refresh silent.
        } finally {
            isAutoRefreshing = false;
        }
    }

    function startAutoRefresh() {
        if (autoRefreshTimerId) {
            window.clearInterval(autoRefreshTimerId);
        }

        autoRefreshTimerId = window.setInterval(() => {
            autoRefreshDashboard();
        }, 5000);
    }

    async function checkSession() {
        try {
            const data = await fetchJson("/api/staff/session");

            if (!data.isAuthenticated) {
                window.location.href = "staff-login.html";
                return;
            }

            staffDashboardEl.hidden = false;
            await loadDashboard();
            setStatus("Dashboard is up to date.", "success");
        } catch (error) {
            setStatus(error.message, "error");
        }
    }

    staffNavButtons.forEach((button) => {
        button.addEventListener("click", () => {
            setActiveSection(button.dataset.section);
        });
    });

    staffNotificationBtn.addEventListener("click", () => {
        const isHidden = staffNotificationPanelEl.hidden;
        staffNotificationPanelEl.hidden = !isHidden;
    });

    document.addEventListener("click", (event) => {
        const wrap = event.target.closest(".admin-notification-wrap");

        if (!wrap) {
            staffNotificationPanelEl.hidden = true;
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            autoRefreshDashboard();
        }
    });

    document.addEventListener("pointerdown", primeAudio, { once: true });
    document.addEventListener("keydown", primeAudio, { once: true });
    staffStockListEl.addEventListener("focusin", markStockEditing);
    staffStockListEl.addEventListener("input", markStockEditing);

    staffRefreshBtn.addEventListener("click", async () => {
        try {
            setStatus("Refreshing dashboard...", "info");
            clearStockEditing();
            await loadDashboard();
            setStatus("Dashboard is up to date.", "success");
        } catch (error) {
            setStatus(error.message, "error");
        }
    });

    staffLogoutBtn.addEventListener("click", async () => {
        try {
            await fetchJson("/api/staff/logout", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                }
            });
        } catch (error) {
            // Ignore and continue redirect.
        }

        window.location.href = "staff-login.html";
    });

    setActiveSection("orders");
    checkSession();
    startAutoRefresh();
});
