document.addEventListener("DOMContentLoaded", () => {
    const usernameEl = document.getElementById("super-admin-username");
    const passwordEl = document.getElementById("super-admin-password");
    const statusEl = document.getElementById("super-admin-login-status");
    const loginButton = document.getElementById("super-admin-login-btn");

    async function request(url, options) {
        const response = await fetch(url, options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Request failed.");
        }

        return data;
    }

    function showStatus(message = "", type = "") {
        statusEl.textContent = message;
        statusEl.className = `payment-status${type ? ` ${type}` : ""}`;
    }

    async function checkSession() {
        try {
            const session = await request("/api/super-admin/session");
            if (!session.hasCredentials) {
                showStatus("Set SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD_HASH in your server environment first.", "error");
                loginButton.disabled = true;
                return;
            }

            if (session.isAuthenticated) {
                window.location.href = "super-admin.html";
            }
        } catch (error) {
            showStatus(error.message, "error");
        }
    }

    loginButton.addEventListener("click", async () => {
        try {
            showStatus("Signing in...", "info");
            loginButton.disabled = true;
            await request("/api/super-admin/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: usernameEl.value.trim(), password: passwordEl.value })
            });
            passwordEl.value = "";
            window.location.href = "super-admin.html";
        } catch (error) {
            showStatus(error.message, "error");
            loginButton.disabled = false;
        }
    });

    passwordEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            loginButton.click();
        }
    });

    checkSession();
});
