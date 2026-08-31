document.addEventListener("DOMContentLoaded", () => {
    const studioEl = document.getElementById("vendor-studio");
    const statusEl = document.getElementById("vendor-status");
    const offerListEl = document.getElementById("vendor-offer-list");
    const orderListEl = document.getElementById("vendor-order-list");
    let siteData = null;
    let orders = [];

    function getRestaurantId() {
        const query = new URLSearchParams(window.location.search);
        return String(query.get("restaurantId") || query.get("restaurant") || localStorage.getItem("hungerstation.restaurantId") || "").trim();
    }

    function withContext(url) {
        const restaurantId = getRestaurantId();
        if (!restaurantId) return url;
        const resolved = new URL(url, window.location.href);
        resolved.searchParams.set("restaurantId", restaurantId);
        return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    }

    async function request(url, options) {
        const response = await fetch(withContext(url), options);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Request failed.");
        return data;
    }

    function setStatus(message, type = "info") {
        statusEl.textContent = message;
        statusEl.className = `payment-status ${type}`;
    }

    function escapeHtml(value) {
        return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
    }

    function formatMoney(value) {
        return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(Number(value || 0));
    }

    function isLive(item) {
        const deadline = item.orderDeadline ? new Date(item.orderDeadline).getTime() : NaN;
        return item.availability !== "hidden" && item.availability !== "out-of-stock" && (!Number.isFinite(deadline) || deadline > Date.now());
    }

    function formatSchedule(value) {
        if (!value) return "No schedule set";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "No schedule set";
        return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", hour12: true }).format(date);
    }

    function populateProfile() {
        const site = siteData.site || {};
        document.getElementById("vendor-page-title").textContent = site.restaurantName || "Vendor Studio";
        document.getElementById("vendor-name").value = site.restaurantName || "";
        document.getElementById("vendor-phone").value = site.phone || "";
        document.getElementById("vendor-email").value = site.email || "";
        document.getElementById("vendor-location").value = site.location || "";
        document.getElementById("vendor-logo-path").value = site.logoPath || "";
        document.getElementById("vendor-storefront-link").href = withContext("index.html");
    }

    function renderOffers() {
        const items = siteData.menuItems || [];
        document.getElementById("vendor-offer-count").textContent = items.filter(isLive).length;
        offerListEl.innerHTML = items.map((item) => `
            <article class="vendor-offer-row">
                <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">
                <div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.category)} · ${formatMoney(item.price)}</span><span>Available: ${escapeHtml(formatSchedule(item.availableFrom))}</span><span>Pre-order closes: ${escapeHtml(formatSchedule(item.orderDeadline))}</span></div>
                <select data-availability="${escapeHtml(item.id)}"><option value="available" ${item.availability === "available" ? "selected" : ""}>Available</option><option value="out-of-stock" ${item.availability === "out-of-stock" ? "selected" : ""}>Sold out</option><option value="hidden" ${item.availability === "hidden" ? "selected" : ""}>Hidden</option></select>
                <button data-delete-offer="${escapeHtml(item.id)}" type="button">Remove</button>
            </article>`).join("") || '<p class="vendor-empty">Add your first food offer above.</p>';
    }

    function renderOrders() {
        const paidOrders = orders.filter((order) => String(order.paymentStatus || "").toLowerCase() === "paid");
        document.getElementById("vendor-order-count").textContent = orders.length;
        document.getElementById("vendor-sales-total").textContent = formatMoney(paidOrders.reduce((total, order) => total + Number(order.total || 0), 0));
        orderListEl.innerHTML = orders.map((order) => `<article class="vendor-order-row"><div><strong>${escapeHtml(order.reference)}</strong><span>${escapeHtml((order.items || []).map((item) => `${item.name} x${item.quantity}`).join(", ") || "No items")}</span></div><div><strong>${formatMoney(order.total)}</strong><span>${escapeHtml(order.status || "Pending")}</span></div></article>`).join("") || '<p class="vendor-empty">No customer orders yet.</p>';
    }

    async function saveSiteData(message) {
        await request("/api/site-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(siteData) });
        setStatus(message, "success");
    }

    async function loadStudio() {
        const session = await request("/api/admin/session");
        if (!session.isAuthenticated) {
            window.location.href = withContext("admin-login.html");
            return;
        }
        if (session.businessType !== "home-vendor") {
            window.location.href = withContext("admin.html");
            return;
        }
        const [nextSiteData, orderData] = await Promise.all([request("/api/site-data"), request("/api/orders")]);
        siteData = nextSiteData;
        orders = orderData.orders || [];
        localStorage.setItem("hungerstation.restaurantId", siteData.restaurantId || getRestaurantId());
        populateProfile();
        renderOffers();
        renderOrders();
        studioEl.hidden = false;
        setStatus("Vendor Studio is ready.", "success");
    }

    document.getElementById("vendor-profile-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        siteData.site = { ...siteData.site, restaurantName: document.getElementById("vendor-name").value.trim(), phone: document.getElementById("vendor-phone").value.trim(), email: document.getElementById("vendor-email").value.trim(), location: document.getElementById("vendor-location").value.trim(), logoPath: document.getElementById("vendor-logo-path").value.trim() };
        try { await saveSiteData("Vendor profile saved."); populateProfile(); } catch (error) { setStatus(error.message, "error"); }
    });

    document.getElementById("vendor-offer-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = document.getElementById("vendor-offer-name").value.trim();
        const price = Number(document.getElementById("vendor-offer-price").value);
        const category = document.getElementById("vendor-offer-category").value.trim();
        const image = document.getElementById("vendor-offer-image").value.trim();
        const availableFrom = document.getElementById("vendor-offer-available-from").value;
        const orderDeadline = document.getElementById("vendor-offer-deadline").value;
        const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${Date.now()}`;
        siteData.categories = [...new Set([...(siteData.categories || []), category])];
        siteData.menuItems = [...(siteData.menuItems || []), { id, name, price, category, image, availability: "available", stockQuantity: null, availableFrom, orderDeadline }];
        try { await saveSiteData("Food offer published."); event.currentTarget.reset(); renderOffers(); } catch (error) { setStatus(error.message, "error"); }
    });

    offerListEl.addEventListener("change", async (event) => {
        const id = event.target.dataset.availability;
        if (!id) return;
        siteData.menuItems = siteData.menuItems.map((item) => item.id === id ? { ...item, availability: event.target.value } : item);
        try { await saveSiteData("Offer availability updated."); renderOffers(); } catch (error) { setStatus(error.message, "error"); }
    });

    offerListEl.addEventListener("click", async (event) => {
        const id = event.target.dataset.deleteOffer;
        if (!id) return;
        siteData.menuItems = siteData.menuItems.filter((item) => item.id !== id);
        try { await saveSiteData("Offer removed."); renderOffers(); } catch (error) { setStatus(error.message, "error"); }
    });

    document.getElementById("vendor-refresh-btn").addEventListener("click", loadStudio);
    document.getElementById("vendor-logout-btn").addEventListener("click", async () => {
        await request("/api/admin/logout", { method: "POST" });
        window.location.href = withContext("admin-login.html");
    });
    loadStudio().catch((error) => setStatus(error.message, "error"));
});
