document.addEventListener("DOMContentLoaded", () => {
    const adminUsernameEl = document.getElementById("admin-username");
    const adminPasswordEl = document.getElementById("admin-password");
    const adminLoginStatusEl = document.getElementById("admin-login-status");
    const adminLoginBtn = document.getElementById("admin-login-btn");

    async function fetchJson(url, options) {
        const response = await fetch(url, options);
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

    async function checkSession() {
        try {
            const data = await fetchJson("/api/admin/session");

            if (!data.hasAdminCredentials) {
                setStatus("Add ADMIN_USERNAME and ADMIN_PASSWORD to your .env file first.", "error");
                adminLoginBtn.disabled = true;
                return;
            }

            if (data.isAuthenticated) {
                window.location.href = "admin.html";
            }
        } catch (error) {
            setStatus(error.message, "error");
        }
    }

    adminLoginBtn.addEventListener("click", async () => {
        try {
            setStatus("Signing in...", "info");

            await fetchJson("/api/admin/login", {
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
            window.location.href = "admin.html";
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
