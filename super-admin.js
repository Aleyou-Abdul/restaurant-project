document.addEventListener("DOMContentLoaded", () => {
    const listEl = document.getElementById("restaurant-list");
    const statusEl = document.getElementById("super-admin-status");
    const serviceFeeEl = document.getElementById("platform-service-fee");
    const paymentRestaurantEl = document.getElementById("payment-restaurant-id");
    const restaurantServiceFeeEl = document.getElementById("restaurant-service-fee");
    const reviewSectionEl = document.getElementById("application-review");
    const reviewTitleEl = document.getElementById("application-review-title");
    const reviewDetailsEl = document.getElementById("application-review-details");
    const reviewApproveBtn = document.getElementById("application-review-approve");
    const reviewDeleteBtn = document.getElementById("application-review-delete");
    const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
    let restaurantsCache = [];
    let selectedRestaurantId = "";

    async function request(url, options) {
        const response = await fetch(url, options);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Request failed.");
        return data;
    }

    function showStatus(message = "", type = "") {
        statusEl.textContent = message;
        statusEl.className = `payment-status${type ? ` ${type}` : ""}`;
    }

    function escapeHtml(value) {
        return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
    }

    function formatDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "Not available" : new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(date);
    }

    function getBusinessTypeLabel(businessType) {
        return businessType === "home-vendor" ? "Home Food Vendor" : "Restaurant";
    }

    function renderRestaurants(restaurants) {
        listEl.innerHTML = restaurants.map((restaurant) => {
            const state = restaurant.suspended ? "suspended" : restaurant.status;
            const action = state === "active" ? "Suspend" : "Approve";
            const nextStatus = state === "active" ? "suspended" : "active";
            const protectedDefault = restaurant.id === "hungerstation-default";
            const isActive = state === "active";
            return `<tr>
                <td><strong>${escapeHtml(restaurant.name)}</strong><small>${escapeHtml(getBusinessTypeLabel(restaurant.businessType))}</small><small>${restaurant.paymentConfigured ? "Payment configured" : "Payment setup needed"}</small></td>
                <td><strong>${escapeHtml(restaurant.ownerName || "Not provided")}</strong><small>${escapeHtml(restaurant.registrationSource === "self-service" ? "Self-service application" : "Platform business")}</small><small>${formatDate(restaurant.createdAt)}</small></td>
                <td>${escapeHtml(restaurant.phone || "No phone")}<small>${escapeHtml(restaurant.ownerPhone || restaurant.email || "No owner contact")}</small><small>${escapeHtml(restaurant.email || "No email")}</small></td>
                <td><span class="super-status ${escapeHtml(state)}">${escapeHtml(state)}</span></td>
                <td class="super-actions"><button data-review="true" data-id="${escapeHtml(restaurant.id)}" type="button">Review</button>${isActive ? `<a class="super-login-link" href="admin-login.html?restaurantId=${encodeURIComponent(restaurant.id)}">Admin</a>` : ""}<button data-status="${nextStatus}" data-id="${escapeHtml(restaurant.id)}" type="button">${action}</button>${protectedDefault ? "" : `<button data-delete="true" data-id="${escapeHtml(restaurant.id)}" class="danger" type="button">Delete</button>`}</td>
            </tr>`;
        }).join("") || '<tr><td colspan="5">No business applications have been received yet.</td></tr>';
    }

    function hideApplicationReview() {
        selectedRestaurantId = "";
        reviewSectionEl.hidden = true;
    }

    function renderApplicationReview(restaurant) {
        if (!restaurant) {
            hideApplicationReview();
            return;
        }

        selectedRestaurantId = restaurant.id;
        const state = restaurant.suspended ? "suspended" : restaurant.status;
        const entries = [
            ["Business", restaurant.name],
            ["Business type", getBusinessTypeLabel(restaurant.businessType)],
            ["Application status", state],
            ["Owner or manager", restaurant.ownerName || "Not provided"],
            ["Owner phone", restaurant.ownerPhone || "Not provided"],
            ["Business phone", restaurant.phone || "Not provided"],
            ["Email", restaurant.email || "Not provided"],
            ["Address", restaurant.address || "Not provided"],
            ["City / state", [restaurant.city, restaurant.state].filter(Boolean).join(", ") || "Not provided"],
            ["About the business", restaurant.applicationNote || "Not provided"],
            ["Submitted", formatDate(restaurant.createdAt)]
        ];

        reviewTitleEl.textContent = `Review: ${restaurant.name}`;
        reviewDetailsEl.innerHTML = entries.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
        reviewApproveBtn.hidden = state === "active";
        reviewApproveBtn.textContent = state === "suspended" ? "Activate business" : "Approve and activate";
        reviewDeleteBtn.hidden = restaurant.id === "hungerstation-default";
        reviewSectionEl.hidden = false;
        reviewSectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function populatePaymentRestaurantOptions(restaurants, defaultServiceFee) {
        const currentValue = paymentRestaurantEl.value;
        paymentRestaurantEl.innerHTML = restaurants.map((restaurant) => (
            `<option value="${escapeHtml(restaurant.id)}">${escapeHtml(restaurant.name)}${restaurant.paymentConfigured ? " (configured)" : " (needs setup)"}</option>`
        )).join("");
        if (restaurants.some((restaurant) => restaurant.id === currentValue)) {
            paymentRestaurantEl.value = currentValue;
        }
        restaurantServiceFeeEl.value = Number(defaultServiceFee || 100);
    }

    async function loadSelectedPaymentSettings() {
        const restaurantId = paymentRestaurantEl.value;
        if (!restaurantId) return;

        const data = await request(`/api/super-admin/restaurants/payment-settings?restaurantId=${encodeURIComponent(restaurantId)}`);
        const form = document.getElementById("restaurant-payment-form");
        form.elements.publicKey.value = data.settings.publicKey || "";
        form.elements.secretKey.value = "";
        form.elements.splitCode.value = data.settings.splitCode || "";
        restaurantServiceFeeEl.value = Number(data.settings.serviceFeeNaira || 100);
    }

    async function loadDashboard() {
        try {
            const data = await request("/api/super-admin/bootstrap");
            document.getElementById("stat-restaurants").textContent = data.statistics.totalRestaurants;
            document.getElementById("stat-active").textContent = data.statistics.activeRestaurants;
            document.getElementById("stat-pending").textContent = data.statistics.pendingRestaurants;
            document.getElementById("stat-revenue").textContent = money.format(data.statistics.platformRevenue);
            serviceFeeEl.value = Number(data.platformSettings.service_fee_naira || 100);
            restaurantsCache = data.restaurants || [];
            renderRestaurants(restaurantsCache);
            populatePaymentRestaurantOptions(restaurantsCache, data.platformSettings.service_fee_naira);
            await loadSelectedPaymentSettings();
            if (selectedRestaurantId) {
                renderApplicationReview(restaurantsCache.find((restaurant) => restaurant.id === selectedRestaurantId));
            }
        } catch (error) {
            if (/Unauthorized/i.test(error.message)) {
                window.location.href = "super-admin-login.html";
                return;
            }
            showStatus(error.message, "error");
        }
    }

    document.getElementById("platform-settings-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            await request("/api/super-admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serviceFeeNaira: serviceFeeEl.value }) });
            showStatus("Platform service fee saved.", "success");
        } catch (error) { showStatus(error.message, "error"); }
    });

    document.getElementById("restaurant-payment-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            const values = Object.fromEntries(new FormData(event.currentTarget).entries());
            await request("/api/super-admin/restaurants/payment-settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(values)
            });
            showStatus("Restaurant payment settings saved. Checkout is now ready when the restaurant is active.", "success");
            await loadDashboard();
        } catch (error) { showStatus(error.message, "error"); }
    });

    paymentRestaurantEl.addEventListener("change", async () => {
        try {
            await loadSelectedPaymentSettings();
        } catch (error) { showStatus(error.message, "error"); }
    });

    listEl.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-id]");
        if (!button) return;
        const restaurantId = button.dataset.id;
        try {
            if (button.dataset.review) {
                renderApplicationReview(restaurantsCache.find((restaurant) => restaurant.id === restaurantId));
                return;
            }
            if (button.dataset.delete) {
                if (!window.confirm("Delete this restaurant and its isolated data? This cannot be undone.")) return;
                await request("/api/super-admin/restaurants/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurantId }) });
                showStatus("Restaurant deleted.", "success");
            } else {
                await request("/api/super-admin/restaurants/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurantId, status: button.dataset.status }) });
                showStatus("Restaurant status updated.", "success");
            }
            await loadDashboard();
        } catch (error) { showStatus(error.message, "error"); }
    });

    reviewApproveBtn.addEventListener("click", async () => {
        if (!selectedRestaurantId) return;
        try {
            await request("/api/super-admin/restaurants/status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ restaurantId: selectedRestaurantId, status: "active" })
            });
            showStatus("Business approved and activated.", "success");
            await loadDashboard();
        } catch (error) { showStatus(error.message, "error"); }
    });

    reviewDeleteBtn.addEventListener("click", async () => {
        if (!selectedRestaurantId || !window.confirm("Delete this business application and its isolated data? This cannot be undone.")) return;
        try {
            await request("/api/super-admin/restaurants/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ restaurantId: selectedRestaurantId })
            });
            hideApplicationReview();
            showStatus("Business application deleted.", "success");
            await loadDashboard();
        } catch (error) { showStatus(error.message, "error"); }
    });

    document.getElementById("application-review-close").addEventListener("click", hideApplicationReview);

    document.getElementById("super-admin-refresh-btn").addEventListener("click", loadDashboard);
    document.getElementById("super-admin-logout-btn").addEventListener("click", async () => {
        await request("/api/super-admin/logout", { method: "POST" });
        window.location.href = "super-admin-login.html";
    });
    loadDashboard();
});
