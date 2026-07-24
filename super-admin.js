document.addEventListener("DOMContentLoaded", () => {
    const listEl = document.getElementById("restaurant-list");
    const statusEl = document.getElementById("super-admin-status");
    const serviceFeeEl = document.getElementById("platform-service-fee");
    const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

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

    function renderRestaurants(restaurants) {
        listEl.innerHTML = restaurants.map((restaurant) => {
            const state = restaurant.suspended ? "suspended" : restaurant.status;
            const action = state === "active" ? "Suspend" : "Approve";
            const nextStatus = state === "active" ? "suspended" : "active";
            const protectedDefault = restaurant.id === "hungerstation-default";
            return `<tr>
                <td><strong>${escapeHtml(restaurant.name)}</strong><small>${escapeHtml(restaurant.slug)}</small></td>
                <td>${escapeHtml(restaurant.phone || "No phone")}<small>${escapeHtml(restaurant.email || "No email")}</small></td>
                <td>${escapeHtml(restaurant.openingTime || "-")} - ${escapeHtml(restaurant.closingTime || "-")}</td>
                <td><span class="super-status ${escapeHtml(state)}">${escapeHtml(state)}</span></td>
                <td class="super-actions"><a class="super-login-link" href="admin-login.html?restaurantId=${encodeURIComponent(restaurant.id)}">Admin</a><button data-status="${nextStatus}" data-id="${escapeHtml(restaurant.id)}" type="button">${action}</button>${protectedDefault ? "" : `<button data-delete="true" data-id="${escapeHtml(restaurant.id)}" class="danger" type="button">Delete</button>`}</td>
            </tr>`;
        }).join("") || '<tr><td colspan="5">No restaurants have been created yet.</td></tr>';
    }

    async function loadDashboard() {
        try {
            const data = await request("/api/super-admin/bootstrap");
            document.getElementById("stat-restaurants").textContent = data.statistics.totalRestaurants;
            document.getElementById("stat-active").textContent = data.statistics.activeRestaurants;
            document.getElementById("stat-pending").textContent = data.statistics.pendingRestaurants;
            document.getElementById("stat-revenue").textContent = money.format(data.statistics.platformRevenue);
            serviceFeeEl.value = Number(data.platformSettings.service_fee_naira || 100);
            renderRestaurants(data.restaurants);
        } catch (error) {
            if (/Unauthorized/i.test(error.message)) {
                window.location.href = "super-admin-login.html";
                return;
            }
            showStatus(error.message, "error");
        }
    }

    document.getElementById("restaurant-create-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        try {
            showStatus("Creating restaurant...", "info");
            const values = Object.fromEntries(new FormData(form).entries());
            await request("/api/super-admin/restaurants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
            form.reset();
            showStatus("Restaurant created. Approve it when its profile and payment settings are ready.", "success");
            await loadDashboard();
        } catch (error) { showStatus(error.message, "error"); }
    });

    document.getElementById("platform-settings-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            await request("/api/super-admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serviceFeeNaira: serviceFeeEl.value }) });
            showStatus("Platform service fee saved.", "success");
        } catch (error) { showStatus(error.message, "error"); }
    });

    listEl.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-id]");
        if (!button) return;
        const restaurantId = button.dataset.id;
        try {
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

    document.getElementById("super-admin-refresh-btn").addEventListener("click", loadDashboard);
    document.getElementById("super-admin-logout-btn").addEventListener("click", async () => {
        await request("/api/super-admin/logout", { method: "POST" });
        window.location.href = "super-admin-login.html";
    });
    loadDashboard();
});
