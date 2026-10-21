document.addEventListener("DOMContentLoaded", () => {
    const adminUsernameEl = document.getElementById("admin-username");
    const adminPasswordEl = document.getElementById("admin-password");
    const adminLoginStatusEl = document.getElementById("admin-login-status");
    const adminLoginBtn = document.getElementById("admin-login-btn");
    const restaurantEl = document.getElementById("admin-restaurant");

    async function fetchJson(url, options) {
        const response = await fetch(withRestaurantContext(url), options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Request failed.");
        }

        return data;
    }

    function setStatus(message = "", type = "") {
        adminLoginStatusEl.textContent = message;
        adminLoginStatusEl.className = `payment-status${type ? ` ${type}` : ""}`;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function getRestaurantContextId() {
        const query = new URLSearchParams(window.location.search);
        const fromUrl = String(query.get("restaurantId") || query.get("restaurant") || "").trim();
        const fromSelection = String(restaurantEl.value || "").trim();
        return fromUrl || fromSelection;
    }

    function setRestaurantContextId(restaurantId) {
        const normalizedId = String(restaurantId || "").trim();

        if (normalizedId) {
            localStorage.setItem("hungerstation.restaurantId", normalizedId);
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set("restaurantId", normalizedId);
            window.history.replaceState({}, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
        }
    }

    function withRestaurantContext(url) {
        const contextId = getRestaurantContextId();

        if (!contextId) {
            return url;
        }

        try {
            const resolvedUrl = new URL(url, window.location.href);

            if (resolvedUrl.origin !== window.location.origin) {
                return url;
            }

            resolvedUrl.searchParams.set("restaurantId", contextId);
            return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
        } catch (error) {
            return url;
        }
    }

    function getDashboardPath(businessType) {
        return businessType === "home-vendor" ? "vendor-admin.html" : "admin.html";
    }

    async function loadApprovedBusinesses() {
        adminLoginBtn.disabled = true;
        restaurantEl.disabled = true;

        try {
            const response = await fetch("/api/restaurants");
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || "We could not load the approved businesses.");
            }

            const businesses = Array.isArray(data.restaurants) ? data.restaurants : [];
            const requestedRestaurantId = new URLSearchParams(window.location.search).get("restaurantId") || "";
            restaurantEl.innerHTML = [
                '<option value="">Select your business</option>',
                ...businesses.map((business) => `<option value="${escapeHtml(business.id)}">${escapeHtml(business.name)}${business.businessType === "home-vendor" ? " (Home Food Vendor)" : ""}</option>`)
            ].join("");
            restaurantEl.disabled = businesses.length === 0;

            if (requestedRestaurantId && businesses.some((business) => business.id === requestedRestaurantId)) {
                restaurantEl.value = requestedRestaurantId;
                setRestaurantContextId(requestedRestaurantId);
            }

            if (!businesses.length) {
                setStatus("There are no approved businesses available to sign in yet.", "info");
                return;
            }

            if (!getRestaurantContextId()) {
                setStatus("Choose your approved business before signing in.", "info");
                return;
            }

            adminLoginBtn.disabled = false;
        } catch (error) {
            restaurantEl.innerHTML = '<option value="">Businesses are unavailable</option>';
            setStatus(error.message || "We could not load the approved businesses.", "error");
        }
    }

    async function checkSession() {
        if (!getRestaurantContextId()) return;

        try {
            const data = await fetchJson("/api/admin/session");

            if (!data.hasAdminCredentials) {
                setStatus("Add ADMIN_USERNAME and ADMIN_PASSWORD to your .env file first.", "error");
                adminLoginBtn.disabled = true;
                return;
            }

            if (data.isAuthenticated) {
                setRestaurantContextId(getRestaurantContextId());
                window.location.href = withRestaurantContext(getDashboardPath(data.businessType));
            }
        } catch (error) {
            setStatus(error.message, "error");
        }
    }

    adminLoginBtn.addEventListener("click", async () => {
        try {
            if (!getRestaurantContextId()) {
                throw new Error("Choose your approved restaurant or home food vendor account first.");
            }
            setStatus("Signing in...", "info");

            const loginData = await fetchJson("/api/admin/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: adminUsernameEl.value.trim(),
                    password: adminPasswordEl.value
                })
            });

            adminPasswordEl.value = "";
            setStatus("Login successful. Redirecting...", "success");
            setRestaurantContextId(getRestaurantContextId());
            window.location.href = withRestaurantContext(getDashboardPath(loginData.businessType));
        } catch (error) {
            setStatus(error.message, "error");
        }
    });

    restaurantEl.addEventListener("change", async () => {
        const restaurantId = String(restaurantEl.value || "").trim();
        adminLoginBtn.disabled = !restaurantId;
        setStatus(restaurantId ? "" : "Choose your approved business before signing in.", restaurantId ? "" : "info");

        if (!restaurantId) return;
        setRestaurantContextId(restaurantId);
        await checkSession();
    });

    adminPasswordEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            adminLoginBtn.click();
        }
    });

    loadApprovedBusinesses().then(checkSession);
});
