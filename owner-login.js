document.addEventListener("DOMContentLoaded", () => {
    const ownerPasswordEl = document.getElementById("owner-password");
    const ownerLoginStatusEl = document.getElementById("owner-login-status");
    const ownerLoginBtn = document.getElementById("owner-login-btn");

    async function fetchJson(url, options) {
        const response = await fetch(url, options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Request failed.");
        }

        return data;
    }

    function setLoginStatus(message = "", type = "") {
        ownerLoginStatusEl.textContent = message;
        ownerLoginStatusEl.className = `payment-status${type ? ` ${type}` : ""}`;
    }

    async function checkSession() {
        try {
            const data = await fetchJson("/api/owner/session");

            if (!data.hasOwnerPassword) {
                setLoginStatus("Add OWNER_PASSWORD to your .env file first.", "error");
                ownerLoginBtn.disabled = true;
                return;
            }

            if (data.isAuthenticated) {
                window.location.href = "owner-report.html";
            }
        } catch (error) {
            setLoginStatus(error.message, "error");
        }
    }

    ownerLoginBtn.addEventListener("click", async () => {
        try {
            setLoginStatus("Opening owner report...", "info");

            await fetchJson("/api/owner/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    password: ownerPasswordEl.value
                })
            });

            ownerPasswordEl.value = "";
            window.location.href = "owner-report.html";
        } catch (error) {
            setLoginStatus(error.message, "error");
        }
    });

    ownerPasswordEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            ownerLoginBtn.click();
        }
    });

    checkSession();
});
