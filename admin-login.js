document.addEventListener("DOMContentLoaded", () => {
    const adminUsernameEl = document.getElementById("admin-username");
    const adminPasswordEl = document.getElementById("admin-password");
    const adminLoginStatusEl = document.getElementById("admin-login-status");
    const adminLoginBtn = document.getElementById("admin-login-btn");

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

    function getRestaurantContextId() {
        const query = new URLSearchParams(window.location.search);
        const fromUrl = String(query.get("restaurantId") || query.get("restaurant") || "").trim();
        const fromStorage = String(localStorage.getItem("hungerstation.restaurantId") || "").trim();
        return fromUrl || fromStorage || "";
    }

    function setRestaurantContextId(restaurantId) {
        const normalizedId = String(restaurantId || "").trim();

        if (normalizedId) {
            localStorage.setItem("hungerstation.restaurantId", normalizedId);
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

    async function checkSession() {
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

    adminPasswordEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            adminLoginBtn.click();
        }
    });

    checkSession();
});
