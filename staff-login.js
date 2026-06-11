document.addEventListener("DOMContentLoaded", () => {
    const usernameEl = document.getElementById("staff-login-username");
    const passwordEl = document.getElementById("staff-login-password");
    const loginBtn = document.getElementById("staff-login-btn");
    const statusEl = document.getElementById("staff-login-status");

    async function fetchJson(url, options) {
        const response = await fetch(url, options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Request failed.");
        }

        return data;
    }

    function setStatus(message, type) {
        statusEl.textContent = message;
        statusEl.className = `payment-status ${type}`;
    }

    async function checkSession() {
        try {
            const data = await fetchJson("/api/staff/session");

            if (data.isAuthenticated) {
                window.location.href = "staff.html";
            }
        } catch (error) {
            setStatus(error.message, "error");
        }
    }

    async function login() {
        try {
            const username = usernameEl.value.trim();
            const password = passwordEl.value;

            if (!username || !password) {
                throw new Error("Enter your username and password.");
            }

            setStatus("Signing in...", "info");
            await fetchJson("/api/staff/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username,
                    password
                })
            });

            setStatus("Login successful. Redirecting...", "success");
            window.setTimeout(() => {
                window.location.href = "staff.html";
            }, 300);
        } catch (error) {
            setStatus(error.message, "error");
        }
    }

    loginBtn.addEventListener("click", login);
    passwordEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            login();
        }
    });

    checkSession();
});
