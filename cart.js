(function () {
    const STORAGE_KEY = "cart";
    const ORDER_NOTE_KEY = "orderNote";
    const DELIVERY_AREA_KEY = "deliveryArea";
    const DELIVERY_LOCATION_KEY = "deliveryLocation";
    const CUSTOMER_PHONE_KEY = "customerPhone";
    const LAST_RECEIPT_KEY = "lastReceipt";
    const SERVICE_FEE = 100;
    let paystackPublicKey = "";
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
            heroSubtitle: site.heroSubtitle || "Fresh food, quick delivery, and easy ordering."
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

    function getMenuItemForCartItem(cartItem) {
        const menuItems = Array.isArray(siteData.menuItems) ? siteData.menuItems : [];
        return menuItems.find((item) => item.id === cartItem.id) ||
            menuItems.find((item) => item.name === cartItem.name) ||
            null;
    }

    function syncCartWithStock() {
        const cart = getCart();
        let didChange = false;

        const nextCart = cart
            .map((cartItem) => {
                const menuItem = getMenuItemForCartItem(cartItem);

                if (!menuItem || menuItem.availability === "hidden" || menuItem.availability === "out-of-stock") {
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
        const receiptBranding = safeLogoPath
            ? `
                <div class="receipt-branding">
                    <img class="receipt-logo" src="${escapeHtml(safeLogoPath)}" alt="${escapeHtml(branding.restaurantName)}">
                    <div>
                        <p class="receipt-kicker">Order confirmed</p>
                        <h4>${escapeHtml(branding.restaurantName)}</h4>
                    </div>
                </div>
            `
            : `
                <div>
                    <p class="receipt-kicker">Order confirmed</p>
                    <h4>${escapeHtml(branding.restaurantName)}</h4>
                </div>
            `;
        const itemsMarkup = order.items.map((item) => `
            <li class="receipt-item-row">
                <span>${escapeHtml(item.name)} x${escapeHtml(item.quantity)}</span>
                <strong>${formatPrice(item.price * item.quantity)}</strong>
            </li>
        `).join("");

        return `
            <div class="receipt-topline">
                ${receiptBranding}
                <span class="receipt-badge">Paid</span>
            </div>
            <div class="receipt-grid">
                <p><strong>Reference:</strong> ${escapeHtml(order.reference)}</p>
                <p><strong>Date:</strong> ${escapeHtml(order.date)}</p>
                <p><strong>Phone:</strong> ${escapeHtml(order.customerPhone)}</p>
                <p><strong>Email:</strong> ${escapeHtml(order.email)}</p>
                <p><strong>Area:</strong> ${escapeHtml(order.deliveryArea)}</p>
                <p><strong>Delivery Fee:</strong> ${formatPrice(order.deliveryFee)}</p>
                <p><strong>Service Fee:</strong> ${formatPrice(order.serviceFee || getServiceFee())}</p>
            </div>
            <div class="receipt-section">
                <div class="receipt-section-title">
                    <strong>Items</strong>
                    <span>${escapeHtml(order.items.length)} item(s)</span>
                </div>
                <ul class="receipt-items-list">${itemsMarkup}</ul>
            </div>
            <div class="receipt-section receipt-meta-box">
                <p><strong>Drop-off:</strong> ${escapeHtml(order.deliveryLocation || "Not provided")}</p>
                <p><strong>Order Note:</strong> ${escapeHtml(order.orderNote || "No special instruction")}</p>
            </div>
            <div class="receipt-total-row">
                <span>Total Paid</span>
                <strong>${formatPrice(order.total)}</strong>
            </div>
        `;
    }

    function getReceiptPrintDocument(receipt) {
        const branding = getBranding();
        const safeLogoPath = getSafeImageSrc(branding.logoPath);
        const printLogo = safeLogoPath
            ? `<img src="${escapeHtml(safeLogoPath)}" alt="${escapeHtml(branding.restaurantName)}" style="width:64px;height:64px;object-fit:cover;border-radius:16px;border:1px solid #ddd;">`
            : "";
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Receipt ${escapeHtml(receipt.reference)}</title><style>body{font-family:Poppins,Arial,sans-serif;margin:0;padding:32px;color:#111;background:#fff}.sheet{max-width:720px;margin:0 auto;border:1px solid #ddd;border-radius:14px;padding:28px}h1,h2,p{margin-top:0}.muted{color:#666}.brand{display:flex;align-items:center;gap:14px;margin-bottom:12px}.receipt-topline{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px}.receipt-branding{display:flex;align-items:center;gap:14px}.receipt-logo{width:56px;height:56px;object-fit:cover;border-radius:14px;border:1px solid #ddd}.receipt-kicker{color:#0f766e;text-transform:uppercase;letter-spacing:.08em;font-size:12px;margin-bottom:6px}.receipt-badge{display:inline-flex;align-items:center;justify-content:center;padding:8px 14px;border-radius:999px;background:#ecfdf5;color:#0a7a28;font-weight:700}ul{margin:8px 0 0;padding-left:0;list-style:none}.receipt-item-row{display:flex;justify-content:space-between;gap:14px;padding:10px 0;border-bottom:1px solid #eee}.receipt-total-row{display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding-top:16px;border-top:2px solid #111;font-size:18px}.receipt-meta-box{padding:14px 16px;border-radius:12px;background:#f8fafc}@media print{body{padding:0}.sheet{border:none;border-radius:0;padding:0}}</style></head><body><div class="sheet"><div class="brand">${printLogo}<div><h1>${escapeHtml(branding.restaurantName)}</h1><p class="muted">Payment Receipt</p></div></div>${buildReceipt(receipt)}</div></body></html>`;
    }

    function openReceiptPrintView(receipt) {
        const printWindow = window.open("", "_blank", "width=900,height=700");

        if (!printWindow) {
            alert("Please allow popups so the receipt can open.");
            return null;
        }

        printWindow.document.open();
        printWindow.document.write(getReceiptPrintDocument(receipt));
        printWindow.document.close();
        return printWindow;
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
        const deliveryBox = document.querySelector(".delivery-box");
        const orderNoteBox = document.querySelector(".order-note-box");
        const orderSuccessBannerEl = document.getElementById("order-success-banner");
        const cartOrderWindowStatusEl = document.getElementById("cart-order-window-status");
        const receipt = getLastReceipt();
        const cart = syncCartWithStock();
        const orderingWindow = getOrderingWindowState();

        cartItemsEl.innerHTML = "";
        updateCartCount(cart);
        cartOrderWindowStatusEl.textContent = orderingWindow.statusText;
        cartOrderWindowStatusEl.className = `payment-status ${orderingWindow.canOrder ? "success" : "error"}`;
        payBtn.disabled = !orderingWindow.canOrder;
        payBtn.textContent = orderingWindow.canOrder ? "Pay Now" : "Ordering Closed";

        if (cart.length === 0) {
            emptyCartEl.style.display = receipt ? "none" : "block";
            payBtn.style.display = "none";
            cartSummaryEl.style.display = receipt ? "flex" : "flex";
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
        deliveryBox.style.display = "block";
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
        const useLocationBtn = document.getElementById("use-location-btn");
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
        deliveryAreaEl.addEventListener("change", () => {
            saveDeliveryArea(deliveryAreaEl.value);
            renderCart();
        });
        deliveryLocationEl.addEventListener("input", () => saveDeliveryLocation(deliveryLocationEl.value.trim()));

        useLocationBtn.addEventListener("click", () => {
            if (!navigator.geolocation) {
                setDeliveryStatus("Current location is not supported on this device.", "error");
                return;
            }

            setDeliveryStatus("Getting your current location...", "info");
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const { latitude, longitude } = position.coords;
                    const locationText = `Current location pinned: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
                    deliveryLocationEl.value = locationText;
                    saveDeliveryLocation(locationText);
                    setDeliveryStatus("Current location added. Please still choose your delivery area for the fee.", "success");
                },
                () => setDeliveryStatus("Could not get your location. You can still type your address manually.", "error")
            );
        });

        closePaymentModalBtn.addEventListener("click", hidePaymentModal);

        printReceiptBtn.addEventListener("click", () => {
            const receipt = getLastReceipt();
            if (!receipt) {
                return;
            }

            const printWindow = openReceiptPrintView(receipt);
            if (printWindow) {
                printWindow.focus();
                printWindow.print();
            }
        });

        downloadReceiptBtn.addEventListener("click", () => {
            const receipt = getLastReceipt();
            if (!receipt) {
                return;
            }

            const printWindow = openReceiptPrintView(receipt);
            if (printWindow) {
                printWindow.focus();
                printWindow.print();
            }
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
            const total = getCartTotal(cart);
            const customerPhone = getCustomerPhone();
            const email = customerEmailEl.value.trim();
            const orderNote = getOrderNote();
            const deliveryLocation = getDeliveryLocation();
            const selectedZone = getSelectedZone();

            if (cart.length === 0) {
                return;
            }

            if (!selectedZone) {
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
                setPaymentStatus("Add your Paystack keys in the server .env file first.", "error");
                return;
            }

            const popup = new PaystackPop();
            popup.newTransaction({
                key: paystackPublicKey,
                email,
                amount: total * 100,
                currency: "NGN",
                reference: `order-${Date.now()}`,
                metadata: {
                    custom_fields: [
                        { display_name: "Order Items", variable_name: "order_items", value: cart.map((item) => `${item.name} x${item.quantity}`).join(", ") },
                        { display_name: "Order Note", variable_name: "order_note", value: orderNote || "No special instruction" },
                        { display_name: "Customer Phone", variable_name: "customer_phone", value: customerPhone },
                        { display_name: "Delivery Area", variable_name: "delivery_area", value: selectedZone.label },
                        { display_name: "Delivery Fee", variable_name: "delivery_fee", value: formatPrice(selectedZone.fee) },
                        { display_name: "Service Fee", variable_name: "service_fee", value: formatPrice(getServiceFee()) },
                        { display_name: "Drop-off Details", variable_name: "delivery_location", value: deliveryLocation || "Customer did not provide extra location details" }
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
                                    deliveryArea: selectedZone.label,
                                    deliveryFee: selectedZone.fee,
                                    serviceFee: getServiceFee(),
                                    deliveryLocation,
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
                            deliveryArea: selectedZone.label,
                            deliveryFee: selectedZone.fee,
                            serviceFee: getServiceFee(),
                            deliveryLocation,
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

        Promise.all([loadConfig(), loadSiteData()])
            .then(([config]) => {
                populateDeliveryAreas();
                deliveryAreaEl.value = getDeliveryArea();

                if (!config.hasSecretKey) {
                    setPaymentStatus("Server is running, but PAYSTACK_SECRET_KEY is still missing.", "info");
                }

                renderCart();
            })
            .catch((error) => {
                setPaymentStatus(`Could not load payment config: ${error.message}`, "error");
            });
    });
})();
