document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("business-registration-form");
    const statusEl = document.getElementById("business-registration-status");
    const submitButton = document.getElementById("business-registration-submit");
    const successEl = document.getElementById("business-registration-success");
    const successMessageEl = document.getElementById("business-registration-success-message");
    const adminLoginLink = document.getElementById("business-registration-login-link");
    const countryEl = document.getElementById("business-country");
    const stateEl = document.getElementById("business-state");
    const localGovernmentEl = document.getElementById("business-local-government");
    const locationButton = document.getElementById("business-location-button");
    const locationStatusEl = document.getElementById("business-location-status");
    const latitudeEl = document.getElementById("business-latitude");
    const longitudeEl = document.getElementById("business-longitude");
    let locationData = null;

    function setStatus(message = "", type = "") {
        statusEl.textContent = message;
        statusEl.className = `payment-status${type ? ` ${type}` : ""}`;
    }

    function setLocationStatus(message = "", type = "") {
        locationStatusEl.textContent = message;
        locationStatusEl.className = `business-location-status${type ? ` ${type}` : ""}`;
    }

    function setAdminLoginLink(restaurantId) {
        const normalizedId = String(restaurantId || "").trim();
        if (!normalizedId) return;
        adminLoginLink.href = `admin-login.html?restaurantId=${encodeURIComponent(normalizedId)}`;
    }

    function setOptions(select, placeholder, values, selectedValue = "") {
        select.innerHTML = [`<option value="">${placeholder}</option>`, ...values.map((value) => `<option value="${value}">${value}</option>`)].join("");
        select.value = selectedValue;
        select.disabled = values.length === 0;
    }

    function getSelectedCountry() {
        return locationData && locationData.countries && locationData.countries[countryEl.value];
    }

    function populateStates(selectedState = "") {
        const country = getSelectedCountry();
        const states = country ? Object.keys(country.states || {}).sort((left, right) => left.localeCompare(right)) : [];
        setOptions(stateEl, "Select state", states, selectedState);
        populateLocalGovernments();
    }

    function populateLocalGovernments(selectedLocalGovernment = "") {
        const country = getSelectedCountry();
        const state = country && country.states ? country.states[stateEl.value] : null;
        const localGovernments = state ? state.localGovernments.map((item) => item.name) : [];
        setOptions(localGovernmentEl, "Select Local Government Area", localGovernments, selectedLocalGovernment);
    }

    async function loadLocationData() {
        try {
            const response = await fetch("nigeria-locations.json", { cache: "force-cache" });
            if (!response.ok) throw new Error("Location list is unavailable.");
            locationData = await response.json();
            const countries = Object.keys(locationData.countries || {}).sort((left, right) => left.localeCompare(right));
            setOptions(countryEl, "Select country", countries, "Nigeria");
            populateStates();
        } catch (error) {
            setStatus("We could not load the business location list. Please refresh and try again.", "error");
            countryEl.innerHTML = '<option value="">Location list unavailable</option>';
        }
    }

    function captureBusinessLocation() {
        if (!navigator.geolocation) {
            setLocationStatus("This browser cannot provide GPS location. Your selected LGA will still be used.", "error");
            return;
        }

        locationButton.disabled = true;
        setLocationStatus("Finding your business location...", "info");
        navigator.geolocation.getCurrentPosition(
            (position) => {
                latitudeEl.value = position.coords.latitude.toFixed(6);
                longitudeEl.value = position.coords.longitude.toFixed(6);
                setLocationStatus(`Location saved (accurate to about ${Math.round(position.coords.accuracy)} metres).`, "success");
                locationButton.disabled = false;
            },
            (error) => {
                const messages = {
                    1: "Location permission was not granted. Your selected LGA will be used instead.",
                    2: "Your location could not be determined. Please try again at the business address.",
                    3: "Location request timed out. Please try again."
                };
                setLocationStatus(messages[error.code] || "Location could not be determined. Your selected LGA will be used instead.", "error");
                locationButton.disabled = false;
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
        );
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

            const businessName = String(values.name || "your business").trim();
            form.reset();
            latitudeEl.value = "";
            longitudeEl.value = "";
            setLocationStatus("");
            countryEl.value = "Nigeria";
            populateStates();
            setStatus("");
            successMessageEl.textContent = `Your application for ${businessName} has been received and is now waiting for review.`;
            setAdminLoginLink(data.application && data.application.restaurantId);
            form.hidden = true;
            successEl.hidden = false;
            successEl.focus();
        } catch (error) {
            setStatus(error.message || "We could not submit your application.", "error");
        } finally {
            submitButton.disabled = false;
        }
    });

    countryEl.addEventListener("change", () => populateStates());
    stateEl.addEventListener("change", () => populateLocalGovernments());
    locationButton.addEventListener("click", captureBusinessLocation);
    loadLocationData();
});
