document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("business-registration-form");
    const statusEl = document.getElementById("business-registration-status");
    const submitButton = document.getElementById("business-registration-submit");

    function setStatus(message = "", type = "") {
        statusEl.textContent = message;
        statusEl.className = `payment-status${type ? ` ${type}` : ""}`;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form).entries());

        if (values.adminPassword !== values.confirmPassword) {
            setStatus("The password confirmation does not match.", "error");
            return;
        }

        try {
            submitButton.disabled = true;
            setStatus("Submitting your application...", "info");
            const response = await fetch("/api/business-applications", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(values)
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || "We could not submit your application.");
            }

            form.reset();
            setStatus("Application received. PlateRoute will verify your business before activating your dashboard.", "success");
        } catch (error) {
            setStatus(error.message || "We could not submit your application.", "error");
        } finally {
            submitButton.disabled = false;
        }
    });
});
