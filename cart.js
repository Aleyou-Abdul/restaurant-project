(function () {
    const STORAGE_KEY = "cart";
    const ORDER_NOTE_KEY = "orderNote";
    const FULFILLMENT_TYPE_KEY = "fulfillmentType";
    const DELIVERY_AREA_KEY = "deliveryArea";
    const DELIVERY_LOCATION_KEY = "deliveryLocation";
    const CUSTOMER_PHONE_KEY = "customerPhone";
    const LAST_RECEIPT_KEY = "lastReceipt";
    const SERVICE_FEE = 100;
    let paystackPublicKey = "";
    let paymentConfig = {
        hasSecretKey: false,
        requiresSplit: true,
        hasSplitConfig: false,
        splitConfig: null
    };
    let siteData = { deliveryZones: [] };

    function parsePrice(value) {
        return Number(String(value).replace(/[^\d]/g, "")) || 0;
    }

    function formatPrice(amount) {
        return `\u20A6${amount}`;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function normalizeLookupValue(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    function getSafeImageSrc(value) {
        const trimmedValue = String(value || "").trim();
        return /^(?:https?:\/\/|\/|\.\/|images\/)/i.test(trimmedValue) ? trimmedValue : "";
    }

    async function fetchJson(url, options) {
        const response = await fetch(url, options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Request failed.");
        }

        return data;
    }

    async function loadConfig() {
        const config = await fetchJson("/api/config");
        paystackPublicKey = config.paystackPublicKey || "";
        paymentConfig = {
            hasSecretKey: Boolean(config.hasSecretKey),
            requiresSplit: config.requiresSplit !== false,
            hasSplitConfig: Boolean(config.hasSplitConfig),
            splitConfig: config.splitConfig || null
        };
        return config;
    }

    async function loadSiteData() {
        siteData = await fetchJson("/api/site-data");
        return siteData;
    }

    function getBranding() {
        const site = siteData.site || {};
        return {
            restaurantName: site.restaurantName || "My Restaurant",
            logoPath: site.logoPath || "",
            heroSubtitle: site.heroSubtitle || "Fresh food, quick delivery, and easy ordering.",
            phone: site.phone || "",
            location: site.location || ""
        };
    }

    function parseTimeToDate(timeValue) {
        const match = String(timeValue || "").match(/^(\d{2}):(\d{2})$/);

        if (!match) {
            return null;
        }

        const date = new Date();
        date.setHours(Number(match[1]), Number(match[2]), 0, 0);
        return date;
    }

    function formatTimeLabel(timeValue) {
        const date = parseTimeToDate(timeValue);

        if (!date) {
            return "";
        }

        return new Intl.DateTimeFormat("en-NG", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true
        }).format(date);
    }

    function getOrderingWindowState() {
        const site = siteData.site || {};
        const opening = parseTimeToDate(site.openingTime);
        const closing = parseTimeToDate(site.closingTime);

        if (!opening || !closing) {
            return {
                canOrder: true,
                statusText: "Ordering is available now."
            };
        }

        const now = new Date();
        const openingTime = new Date(opening);
        const closingTime = new Date(closing);

        if (closingTime <= openingTime) {
            if (now < closingTime) {
                openingTime.setDate(openingTime.getDate() - 1);
            } else {
                closingTime.setDate(closingTime.getDate() + 1);
            }
        }

        const canOrder = now >= openingTime && now < closingTime;
        return {
            canOrder,
            statusText: canOrder
                ? `Ordering is open now. Closes at ${formatTimeLabel(site.closingTime)}.`
                : `Ordering is closed now. Opens at ${formatTimeLabel(site.openingTime)}.`
        };
    }

    function applySiteBranding() {
        const branding = getBranding();
        const headerLogoTextEl = document.getElementById("cart-site-logo");
        const headerLogoImageEl = document.getElementById("cart-site-logo-image");
        const footerLogoImageEl = document.getElementById("cart-footer-logo-image");

        document.title = `Your Cart | ${branding.restaurantName}`;
        headerLogoTextEl.textContent = branding.restaurantName;
        document.getElementById("cart-footer-name").textContent = branding.restaurantName;
        document.getElementById("cart-footer-tagline").textContent = branding.heroSubtitle;
        document.getElementById("cart-footer-bottom-name").textContent = branding.restaurantName;

        if (branding.logoPath) {
            headerLogoImageEl.src = branding.logoPath;
            headerLogoImageEl.hidden = false;
            footerLogoImageEl.src = branding.logoPath;
            footerLogoImageEl.hidden = false;
        } else {
            headerLogoImageEl.hidden = true;
            headerLogoImageEl.removeAttribute("src");
            footerLogoImageEl.hidden = true;
            footerLogoImageEl.removeAttribute("src");
        }
    }

    function normalizeCart(rawCart) {
        if (!Array.isArray(rawCart)) {
            return [];
        }

        return rawCart
            .map((item) => {
                if (!item) {
                    return null;
                }

                const name = String(item.name || "").trim();
                const id = String(item.id || item.name || "").trim();
                const price = parsePrice(item.price);
                const quantity = Number(item.quantity || 0);

                if (!name || price <= 0 || quantity <= 0) {
                    return null;
                }

                return { id, name, price, quantity };
            })
            .filter(Boolean);
    }

    function readRawCart() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
        } catch (error) {
            return [];
        }
    }

    function getCart() {
        const cart = normalizeCart(readRawCart());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
        return cart;
    }

    function saveCart(cart) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeCart(cart)));
    }

    function updateCartCount(cart) {
        const cartCountEl = document.getElementById("cart-count");
        const totalItems = cart.reduce((total, item) => total + item.quantity, 0);

        if (cartCountEl) {
            cartCountEl.textContent = totalItems;
        }
    }

    function getOrderNote() {
        return localStorage.getItem(ORDER_NOTE_KEY) || "";
    }

    function saveOrderNote(note) {
        localStorage.setItem(ORDER_NOTE_KEY, note);
    }

    function getFulfillmentType() {
        return localStorage.getItem(FULFILLMENT_TYPE_KEY) === "pickup" ? "pickup" : "delivery";
    }

    function saveFulfillmentType(type) {
        localStorage.setItem(FULFILLMENT_TYPE_KEY, type === "pickup" ? "pickup" : "delivery");
    }

    function isPickupOrder() {
        return getFulfillmentType() === "pickup";
    }

    function getDeliveryArea() {
        return localStorage.getItem(DELIVERY_AREA_KEY) || "";
    }

    function saveDeliveryArea(area) {
        localStorage.setItem(DELIVERY_AREA_KEY, area);
    }

    function getDeliveryLocation() {
        return localStorage.getItem(DELIVERY_LOCATION_KEY) || "";
    }

    function saveDeliveryLocation(location) {
        localStorage.setItem(DELIVERY_LOCATION_KEY, location);
    }

    function getCustomerPhone() {
        return localStorage.getItem(CUSTOMER_PHONE_KEY) || "";
    }

    function saveCustomerPhone(phone) {
        localStorage.setItem(CUSTOMER_PHONE_KEY, phone);
    }

    function getLastReceipt() {
        try {
            return JSON.parse(localStorage.getItem(LAST_RECEIPT_KEY)) || null;
        } catch (error) {
            return null;
        }
    }

    function saveLastReceipt(receipt) {
        localStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(receipt));
    }

    function getSelectedZone() {
        return (siteData.deliveryZones || []).find((zone) => zone.value === getDeliveryArea()) || null;
    }

    function getDeliveryFee() {
        if (isPickupOrder()) {
            return 0;
        }

        const zone = getSelectedZone();
        return zone ? zone.fee : 0;
    }

    function getServiceFee() {
        return SERVICE_FEE;
    }

    function getCartSubtotal(cart) {
        return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    }

    function getCartTotal(cart) {
        return getCartSubtotal(cart) + getDeliveryFee() + getServiceFee();
    }

    function getFulfillmentLabel(type) {
        return type === "pickup" ? "Pickup" : "Delivery";
    }

    function getPaystackSplitOptions() {
        const splitConfig = paymentConfig.splitConfig || {};

        if (splitConfig.mode === "split-code" && splitConfig.splitCode) {
            return {
                split_code: splitConfig.splitCode
            };
        }

        if (splitConfig.mode === "subaccount" && splitConfig.subaccountCode) {
            const options = {
                subaccountCode: splitConfig.subaccountCode
            };

            if (Number(splitConfig.transactionChargeKobo || 0) > 0) {
                options.transactionCharge = Number(splitConfig.transactionChargeKobo);
            }

            if (splitConfig.bearer) {
                options.bearer = splitConfig.bearer;
            }

            return options;
        }

        return {};
    }

    function getMenuItemForCartItem(cartItem) {
        const menuItems = Array.isArray(siteData.menuItems) ? siteData.menuItems : [];
        const cartId = normalizeLookupValue(cartItem && cartItem.id);
        const cartName = normalizeLookupValue(cartItem && cartItem.name);
        return menuItems.find((item) => normalizeLookupValue(item.id) === cartId) ||
            menuItems.find((item) => normalizeLookupValue(item.name) === cartName) ||
            null;
    }

    function syncCartWithStock() {
        const cart = getCart();
        let didChange = false;

        // The cart is reconciled against live menu stock so payment cannot go through on stale quantities.
        const nextCart = cart
            .map((cartItem) => {
                const menuItem = getMenuItemForCartItem(cartItem);

                if (!menuItem) {
                    return cartItem;
                }

                if (menuItem.availability === "hidden" || menuItem.availability === "out-of-stock") {
                    didChange = true;
                    return null;
                }

                if (menuItem.stockQuantity !== null && cartItem.quantity > menuItem.stockQuantity) {
                    didChange = true;
                    return {
                        ...cartItem,
                        id: menuItem.id,
                        quantity: menuItem.stockQuantity
                    };
                }

                return {
                    ...cartItem,
                    id: menuItem.id
                };
            })
            .filter((item) => item && item.quantity > 0);

        if (didChange) {
            saveCart(nextCart);
        }

        return didChange ? nextCart : cart;
    }

    function populateDeliveryAreas() {
        const deliveryAreaEl = document.getElementById("delivery-area");
        deliveryAreaEl.innerHTML = '<option value="">Select your area</option>';

        (siteData.deliveryZones || []).forEach((zone) => {
            const option = document.createElement("option");
            option.value = zone.value;
            option.textContent = `${zone.label} - ${formatPrice(zone.fee)}`;
            deliveryAreaEl.appendChild(option);
        });
    }

    function buildReceipt(order) {
        const branding = getBranding();
        const safeLogoPath = getSafeImageSrc(branding.logoPath);
        const subtotal = order.subtotal || order.total - (order.deliveryFee || 0) - (order.serviceFee || getServiceFee());
        const totalItems = (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const fulfillmentType = order.fulfillmentType === "pickup" ? "pickup" : "delivery";
        const fulfillmentLabel = getFulfillmentLabel(fulfillmentType);
        const receiptBranding = `
            <div class="receipt-thermal-brand">
                ${safeLogoPath ? `<img class="receipt-logo receipt-logo-thermal" src="${escapeHtml(safeLogoPath)}" alt="${escapeHtml(branding.restaurantName)}">` : ""}
                <h4>${escapeHtml(branding.restaurantName)}</h4>
                ${branding.phone ? `<p class="receipt-thermal-contact">${escapeHtml(branding.phone)}</p>` : ""}
                ${branding.location ? `<p class="receipt-thermal-contact">${escapeHtml(branding.location)}</p>` : ""}
                <p class="receipt-kicker receipt-kicker-thermal">Order receipt</p>
            </div>
        `;
        const itemsMarkup = order.items.map((item) => `
            <li class="receipt-thermal-item">
                <span class="receipt-thermal-item-qty">${escapeHtml(item.quantity)}x</span>
                <span class="receipt-thermal-item-name">${escapeHtml(item.name)}</span>
                <strong class="receipt-thermal-item-price">${formatPrice(item.price * item.quantity)}</strong>
            </li>
        `).join("");

        return `
            <div class="receipt-pos receipt-pos-thermal">
                ${receiptBranding}
                <div class="receipt-divider receipt-divider-thermal"></div>
                <h5 class="receipt-thermal-title">SALES RECEIPT</h5>
                <div class="receipt-divider receipt-divider-thermal"></div>
                <div class="receipt-thermal-meta">
                    <span>${escapeHtml(order.reference)}</span>
                    <span>${escapeHtml(order.date)}</span>
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
                <p><span>Service Fee:</span><strong>${formatPrice(order.serviceFee || getServiceFee())}</strong></p>
            </div>
            <div class="receipt-divider receipt-divider-thermal"></div>
            <div class="receipt-total-row receipt-total-row-pos receipt-total-row-thermal">
                <span>Total:</span>
                <strong>${formatPrice(order.total)}</strong>
            </div>
            <div class="receipt-thermal-details">
                <p><strong>Type:</strong> <span>${escapeHtml(fulfillmentLabel)}</span></p>
                <p><strong>Phone:</strong> <span>${escapeHtml(order.customerPhone)}</span></p>
                <p><strong>Email:</strong> <span>${escapeHtml(order.email)}</span></p>
                <p><strong>Area:</strong> <span>${escapeHtml(order.deliveryArea || fulfillmentLabel)}</span></p>
                <p><strong>Drop-off:</strong> <span>${escapeHtml(order.deliveryLocation || (fulfillmentType === "pickup" ? "Customer pickup" : "Not provided"))}</span></p>
                <p><strong>Note:</strong> <span>${escapeHtml(order.orderNote || "No special instruction")}</span></p>
            </div>
            <div class="receipt-divider receipt-divider-thermal"></div>
            <p class="receipt-thank-you receipt-thank-you-thermal">THANK YOU</p>
        `;
    }

    function getReceiptPrintDocument(receipt) {
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Receipt ${escapeHtml(receipt.reference)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="style.css?v=20260512e"><style>@page{size:80mm 297mm;margin:1mm}body{width:80mm;margin:0 auto;padding:0;background:#fff;color:#111;font-family:Poppins,Arial,sans-serif}.print-shell{width:72mm;margin:0 auto;zoom:.9}.print-shell .receipt-card{margin-top:0;padding:5px 5px 3px;border:none;border-radius:0;background:#fcfcfc;box-shadow:none}.print-shell .receipt-pos{width:min(100%,280px);gap:3px;font-size:10px}.print-shell .receipt-logo{width:50px;height:50px;margin:0 auto 3px}.print-shell .receipt-thermal-brand h4{font-size:13px;line-height:1}.print-shell .receipt-thermal-contact{font-size:8px;line-height:1.05}.print-shell .receipt-kicker{margin-top:1px;font-size:8px;letter-spacing:.06em}.print-shell .receipt-divider{margin:3px 0}.print-shell .receipt-thermal-title{font-size:14px;margin:1px 0}.print-shell .receipt-thermal-meta{font-size:8px;gap:3px}.print-shell .receipt-thermal-table-head,.print-shell .receipt-thermal-item{grid-template-columns:24px 1fr auto;gap:4px}.print-shell .receipt-thermal-table-head{font-size:8px}.print-shell .receipt-thermal-item{padding:2px 0;font-size:9px}.print-shell .receipt-thermal-count{margin:3px 0;font-size:9px}.print-shell .receipt-breakdown{gap:1px}.print-shell .receipt-breakdown p{font-size:9px;gap:4px}.print-shell .receipt-total-row{margin-top:3px;padding-top:3px;font-size:12px;gap:4px}.print-shell .receipt-total-row strong{font-size:16px}.print-shell .receipt-thermal-details{gap:1px}.print-shell .receipt-thermal-details p{font-size:8px;gap:3px;line-height:1}.print-shell .receipt-thank-you{margin:4px 0 3px;font-size:12px}.receipt-footer-meta{margin-top:3px;padding-top:3px;border-top:1px dashed #777;display:flex;justify-content:space-between;gap:3px;font-size:7px;font-family:'Courier New',monospace;page-break-inside:avoid}.receipt-footer-meta span:last-child{text-align:right}@media print{body{width:80mm;padding:0}.print-shell{width:72mm;zoom:.9}}</style></head><body><div class="print-shell"><section class="receipt-card">${buildReceipt(receipt)}<div class="receipt-footer-meta"><span>${escapeHtml(receipt.reference)}</span><span>${escapeHtml(receipt.date)}</span></div></section></div></body></html>`;
    }

    function printReceiptDocument(receipt) {
        const key = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const returnUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        localStorage.setItem(`printDocument:${key}`, getReceiptPrintDocument(receipt));
        window.location.href = `receipt-print.html?key=${encodeURIComponent(key)}&return=${encodeURIComponent(returnUrl)}`;
    }

    function renderReceipt(receipt) {
        const receiptCardEl = document.getElementById("receipt-card");
        const receiptContentEl = document.getElementById("receipt-content");

        if (!receipt) {
            receiptCardEl.hidden = true;
            receiptContentEl.innerHTML = "";
            return;
        }

        receiptContentEl.innerHTML = buildReceipt(receipt);
        receiptCardEl.hidden = false;
    }

    function renderCart() {
        const cartItemsEl = document.getElementById("cart-items");
        const cartSubtotalEl = document.getElementById("cart-subtotal");
        const deliveryFeeEl = document.getElementById("delivery-fee");
        const serviceFeeEl = document.getElementById("service-fee");
        const cartTotalEl = document.getElementById("cart-total");
        const emptyCartEl = document.getElementById("empty-cart");
        const payBtn = document.getElementById("pay-btn");
        const cartSummaryEl = document.querySelector(".cart-summary");
        const fulfillmentBox = document.querySelector(".fulfillment-box");
        const fulfillmentHelpEl = document.getElementById("fulfillment-help");
        const deliveryBox = document.querySelector(".delivery-box");
        const orderNoteBox = document.querySelector(".order-note-box");
        const orderSuccessBannerEl = document.getElementById("order-success-banner");
        const cartOrderWindowStatusEl = document.getElementById("cart-order-window-status");
        const receipt = getLastReceipt();
        const cart = syncCartWithStock();
        const orderingWindow = getOrderingWindowState();
        const fulfillmentType = getFulfillmentType();
        const isPickup = fulfillmentType === "pickup";

        cartItemsEl.innerHTML = "";
        updateCartCount(cart);
        document.querySelectorAll(".fulfillment-option").forEach((button) => {
            button.classList.toggle("is-active", button.dataset.fulfillmentType === fulfillmentType);
        });
        fulfillmentHelpEl.textContent = isPickup
            ? "Pickup orders only include food total and service fee."
            : "Delivery orders include the selected area fee.";
        cartOrderWindowStatusEl.textContent = orderingWindow.statusText;
        cartOrderWindowStatusEl.className = `payment-status ${orderingWindow.canOrder ? "success" : "error"}`;
        payBtn.disabled = !orderingWindow.canOrder;
        payBtn.textContent = orderingWindow.canOrder ? "Pay Now" : "Ordering Closed";

        if (cart.length === 0) {
            emptyCartEl.style.display = receipt ? "none" : "block";
            payBtn.style.display = "none";
            cartSummaryEl.style.display = receipt ? "flex" : "flex";
            fulfillmentBox.style.display = "none";
            deliveryBox.style.display = "none";
            orderNoteBox.style.display = "none";
            orderSuccessBannerEl.hidden = !receipt;
            cartSubtotalEl.textContent = formatPrice(0);
            deliveryFeeEl.textContent = formatPrice(0);
            serviceFeeEl.textContent = formatPrice(getServiceFee());
            cartTotalEl.textContent = formatPrice(receipt ? receipt.total : 0);
            if (receipt) {
                cartSummaryEl.style.display = "none";
            }
            return;
        }

        emptyCartEl.style.display = "none";
        payBtn.style.display = "inline-block";
        cartSummaryEl.style.display = "flex";
        fulfillmentBox.style.display = "grid";
        deliveryBox.style.display = isPickup ? "none" : "block";
        orderNoteBox.style.display = "block";
        orderSuccessBannerEl.hidden = true;

        const subtotal = getCartSubtotal(cart);

        cart.forEach((item, index) => {
            const itemSubtotal = item.price * item.quantity;
            const menuItem = getMenuItemForCartItem(item);
            const maxQuantity = menuItem && menuItem.stockQuantity !== null ? menuItem.stockQuantity : null;
            const stockHint = !menuItem
                ? "Item not found in menu."
                : menuItem.availability === "low-stock"
                    ? `Only ${menuItem.stockQuantity} left`
                    : maxQuantity !== null
                        ? `${maxQuantity} available`
                        : "Available";
            const row = document.createElement("div");
            row.className = "cart-item";
            row.innerHTML = `
                <div class="cart-item-info">
                    <h3>${escapeHtml(item.name)}</h3>
                    <p>Price: ${formatPrice(item.price)}</p>
                    <p>Subtotal: ${formatPrice(itemSubtotal)}</p>
                    <p>${escapeHtml(stockHint)}</p>
                </div>
                <div class="cart-item-actions">
                    <div class="cart-qty-controls">
                        <button class="qty-btn" type="button" data-index="${index}" data-change="-1">-</button>
                        <span class="cart-qty-value">${item.quantity}</span>
                        <button class="qty-btn" type="button" data-index="${index}" data-change="1" ${maxQuantity !== null && item.quantity >= maxQuantity ? "disabled" : ""}>+</button>
                    </div>
                    <button class="remove-btn" type="button" data-index="${index}">Remove</button>
                </div>
            `;
            cartItemsEl.appendChild(row);
        });

        cartSubtotalEl.textContent = formatPrice(subtotal);
        deliveryFeeEl.textContent = formatPrice(getDeliveryFee());
        serviceFeeEl.textContent = formatPrice(getServiceFee());
        cartTotalEl.textContent = formatPrice(getCartTotal(cart));
    }

    document.addEventListener("DOMContentLoaded", () => {
        const cartItemsEl = document.getElementById("cart-items");
        const payBtn = document.getElementById("pay-btn");
        const deliveryAreaEl = document.getElementById("delivery-area");
        const deliveryLocationEl = document.getElementById("delivery-location");
        const fulfillmentOptionBtns = document.querySelectorAll(".fulfillment-option");
        const deliveryStatusEl = document.getElementById("delivery-status");
        const customerPhoneEl = document.getElementById("customer-phone");
        const customerEmailEl = document.getElementById("customer-email");
        const paymentStatusEl = document.getElementById("payment-status");
        const paymentModalEl = document.getElementById("payment-modal");
        const paymentModalTitleEl = document.getElementById("payment-modal-title");
        const paymentModalMessageEl = document.getElementById("payment-modal-message");
        const closePaymentModalBtn = document.getElementById("close-payment-modal");
        const downloadReceiptBtn = document.getElementById("download-receipt-btn");
        const printReceiptBtn = document.getElementById("print-receipt-btn");
        const orderNoteEl = document.getElementById("order-note");

        function setPaymentStatus(message, type) {
            paymentStatusEl.textContent = message;
            paymentStatusEl.className = `payment-status${type ? ` ${type}` : ""}`;
        }

        function showPaymentModal(title, message, type) {
            paymentModalTitleEl.textContent = title;
            paymentModalMessageEl.textContent = message;
            paymentModalEl.className = `payment-modal is-visible${type ? ` ${type}` : ""}`;
            paymentModalEl.setAttribute("aria-hidden", "false");
        }

        function hidePaymentModal() {
            paymentModalEl.className = "payment-modal";
            paymentModalEl.setAttribute("aria-hidden", "true");
        }

        function setDeliveryStatus(message, type) {
            deliveryStatusEl.textContent = message;
            deliveryStatusEl.className = `delivery-status${type ? ` ${type}` : ""}`;
        }

        deliveryLocationEl.value = getDeliveryLocation();
        customerPhoneEl.value = getCustomerPhone();
        orderNoteEl.value = getOrderNote();
        renderReceipt(getLastReceipt());

        orderNoteEl.addEventListener("input", () => saveOrderNote(orderNoteEl.value.trim()));
        customerPhoneEl.addEventListener("input", () => saveCustomerPhone(customerPhoneEl.value.trim()));
        fulfillmentOptionBtns.forEach((button) => {
            button.addEventListener("click", () => {
                saveFulfillmentType(button.dataset.fulfillmentType);
                setDeliveryStatus("", "");
                renderCart();
            });
        });
        deliveryAreaEl.addEventListener("change", () => {
            saveDeliveryArea(deliveryAreaEl.value);
            renderCart();
        });
        deliveryLocationEl.addEventListener("input", () => saveDeliveryLocation(deliveryLocationEl.value.trim()));

        closePaymentModalBtn.addEventListener("click", hidePaymentModal);

        printReceiptBtn.addEventListener("click", () => {
            const receipt = getLastReceipt();
            if (!receipt) {
                return;
            }

            printReceiptDocument(receipt);
        });

        downloadReceiptBtn.addEventListener("click", () => {
            const receipt = getLastReceipt();
            if (!receipt) {
                return;
            }

            printReceiptDocument(receipt);
        });

        cartItemsEl.addEventListener("click", (event) => {
            const target = event.target;
            const cart = getCart();
            const index = Number(target.dataset.index);

            if (Number.isNaN(index) || !cart[index]) {
                return;
            }

            if (target.classList.contains("remove-btn")) {
                cart.splice(index, 1);
                saveCart(cart);
                renderCart();
                return;
            }

            if (target.classList.contains("qty-btn")) {
                const change = Number(target.dataset.change);
                const menuItem = getMenuItemForCartItem(cart[index]);
                const nextQuantity = cart[index].quantity + change;

                if (change > 0 && menuItem && menuItem.stockQuantity !== null && nextQuantity > menuItem.stockQuantity) {
                    setPaymentStatus(`Only ${menuItem.stockQuantity} ${menuItem.name} left right now.`, "info");
                    renderCart();
                    return;
                }

                cart[index].quantity = nextQuantity;

                if (cart[index].quantity <= 0) {
                    cart.splice(index, 1);
                }

                saveCart(cart);
                renderCart();
            }
        });

        payBtn.addEventListener("click", async () => {
            const orderingWindow = getOrderingWindowState();

            if (!orderingWindow.canOrder) {
                setPaymentStatus(orderingWindow.statusText, "error");
                showPaymentModal("Ordering Closed", orderingWindow.statusText, "error");
                return;
            }

            try {
                await loadSiteData();
                applySiteBranding();
                const stockSyncedCart = syncCartWithStock();
                renderCart();

                if (stockSyncedCart.length === 0) {
                    setPaymentStatus("Your cart changed because some items are no longer available.", "info");
                    return;
                }
            } catch (error) {
                setPaymentStatus(`Could not refresh stock: ${error.message}`, "error");
                return;
            }

            const cart = getCart();
            const fulfillmentType = getFulfillmentType();
            const fulfillmentLabel = getFulfillmentLabel(fulfillmentType);
            const total = getCartTotal(cart);
            const customerPhone = getCustomerPhone();
            const email = customerEmailEl.value.trim();
            const orderNote = getOrderNote();
            const deliveryLocation = getDeliveryLocation();
            const selectedZone = getSelectedZone();
            const deliveryAreaLabel = fulfillmentType === "pickup" ? "Pickup" : selectedZone ? selectedZone.label : "";
            const deliveryFee = fulfillmentType === "pickup" ? 0 : selectedZone ? selectedZone.fee : 0;
            const dropOffDetails = fulfillmentType === "pickup" ? "Customer pickup" : deliveryLocation;

            if (cart.length === 0) {
                return;
            }

            if (fulfillmentType === "delivery" && !selectedZone) {
                setDeliveryStatus("Please choose your delivery area before making payment.", "error");
                deliveryAreaEl.focus();
                return;
            }

            if (!customerPhone) {
                setPaymentStatus("Please enter the customer's phone number before making payment.", "error");
                customerPhoneEl.focus();
                return;
            }

            if (!email) {
                alert("Please enter your email address before making payment.");
                customerEmailEl.focus();
                return;
            }

            if (!window.PaystackPop) {
                alert("Paystack could not load. Please check your internet connection and try again.");
                return;
            }

            if (!paystackPublicKey) {
                setPaymentStatus("Add your Paystack public key in Render Environment first.", "error");
                return;
            }

            if (!paymentConfig.hasSecretKey) {
                setPaymentStatus("Add your Paystack secret key in Render Environment first.", "error");
                return;
            }

            if (paymentConfig.requiresSplit && !paymentConfig.hasSplitConfig) {
                setPaymentStatus("Payment split is not configured. Add PAYSTACK_SPLIT_CODE before accepting orders.", "error");
                return;
            }

            const popup = new PaystackPop();
            popup.newTransaction({
                key: paystackPublicKey,
                email,
                amount: total * 100,
                currency: "NGN",
                reference: `order-${Date.now()}`,
                ...getPaystackSplitOptions(),
                metadata: {
                    custom_fields: [
                        { display_name: "Order Items", variable_name: "order_items", value: cart.map((item) => `${item.name} x${item.quantity}`).join(", ") },
                        { display_name: "Order Note", variable_name: "order_note", value: orderNote || "No special instruction" },
                        { display_name: "Customer Phone", variable_name: "customer_phone", value: customerPhone },
                        { display_name: "Order Type", variable_name: "fulfillment_type", value: fulfillmentLabel },
                        { display_name: "Delivery Area", variable_name: "delivery_area", value: deliveryAreaLabel },
                        { display_name: "Delivery Fee", variable_name: "delivery_fee", value: formatPrice(deliveryFee) },
                        { display_name: "Service Fee", variable_name: "service_fee", value: formatPrice(getServiceFee()) },
                        { display_name: "Drop-off Details", variable_name: "delivery_location", value: dropOffDetails || "Customer did not provide extra location details" }
                    ]
                },
                onSuccess: async (transaction) => {
                    try {
                        setPaymentStatus("Verifying payment with the server...", "info");

                        await fetchJson("/api/paystack/verify", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                reference: transaction.reference,
                                expectedAmount: total * 100,
                                order: {
                                    email,
                                    customerPhone,
                                    fulfillmentType,
                                    deliveryArea: deliveryAreaLabel,
                                    deliveryFee,
                                    serviceFee: getServiceFee(),
                                    deliveryLocation: dropOffDetails,
                                    orderNote,
                                    total,
                                    items: cart
                                }
                            })
                        });

                        const receipt = {
                            reference: transaction.reference,
                            date: new Date().toLocaleString(),
                            email,
                            customerPhone,
                            fulfillmentType,
                            deliveryArea: deliveryAreaLabel,
                            deliveryFee,
                            serviceFee: getServiceFee(),
                            deliveryLocation: dropOffDetails,
                            orderNote,
                            total,
                            items: cart
                        };

                        saveLastReceipt(receipt);
                        renderReceipt(receipt);
                        saveCart([]);
                        saveOrderNote("");
                        saveDeliveryLocation("");
                        saveDeliveryArea("");
                        saveFulfillmentType("delivery");
                        saveCustomerPhone("");
                        orderNoteEl.value = "";
                        deliveryLocationEl.value = "";
                        deliveryAreaEl.value = "";
                        customerPhoneEl.value = "";
                        customerEmailEl.value = "";
                        renderCart();
                        setPaymentStatus(`Payment verified successfully. Reference: ${transaction.reference}`, "success");
                        showPaymentModal("Payment Successful", "Your payment has been received and your receipt is ready below.", "success");
                    } catch (error) {
                        setPaymentStatus(error.message, "error");
                        showPaymentModal("Payment Verification Failed", error.message, "error");
                    }
                },
                onCancel: () => {
                    setPaymentStatus("Payment was cancelled.", "info");
                    showPaymentModal("Payment Cancelled", "The payment was not completed.", "info");
                },
                onError: (error) => {
                    setPaymentStatus(`Payment error: ${error.message}`, "error");
                    showPaymentModal("Payment Error", error.message, "error");
                }
            });
        });

        Promise.allSettled([loadSiteData(), loadConfig()])
            .then((results) => {
                const [siteDataResult, configResult] = results;

                if (siteDataResult.status === "fulfilled") {
                    applySiteBranding();
                    populateDeliveryAreas();
                    deliveryAreaEl.value = getDeliveryArea();
                    renderCart();
                } else {
                    setPaymentStatus(`Could not load site data: ${siteDataResult.reason.message}`, "error");
                    return;
                }

                if (configResult.status === "fulfilled") {
                    if (!configResult.value.hasSecretKey) {
                        setPaymentStatus("Server is running, but PAYSTACK_SECRET_KEY is still missing.", "info");
                    } else if (configResult.value.requiresSplit !== false && !configResult.value.hasSplitConfig) {
                        setPaymentStatus("Payment split is required. Add PAYSTACK_SPLIT_CODE in Render before accepting orders.", "error");
                    }
                } else {
                    setPaymentStatus(`Payment setup is not ready yet: ${configResult.reason.message}`, "info");
                }
            })
            .catch((error) => {
                setPaymentStatus(`Could not load cart page: ${error.message}`, "error");
            });
    });
})();
