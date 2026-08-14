document.addEventListener("DOMContentLoaded", () => {
    const listEl = document.getElementById("restaurant-directory-list");
    const countEl = document.getElementById("restaurant-count");
    const searchEl = document.getElementById("restaurant-search-input");
    let restaurants = [];

    function escapeHtml(value) {
        return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
    }

    function imageSource(value) {
        const source = String(value || "").trim();
        return /^(?:https?:\/\/|\/|\.\/|images\/)/i.test(source) ? source : "images/menu-placeholder.svg";
    }

    function formatHours(restaurant) {
        if (!restaurant.openingTime || !restaurant.closingTime) return "Hours not set";
        const format = (value) => {
            const [hour, minute] = value.split(":").map(Number);
            const date = new Date(2000, 0, 1, hour, minute || 0);
            return new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
        };
        return `${format(restaurant.openingTime)} - ${format(restaurant.closingTime)}`;
    }

    function render() {
        const query = searchEl.value.trim().toLowerCase();
        const matches = restaurants.filter((restaurant) => `${restaurant.name} ${restaurant.address}`.toLowerCase().includes(query));
        countEl.textContent = `${matches.length} restaurant${matches.length === 1 ? "" : "s"}`;
        listEl.innerHTML = matches.map((restaurant) => `
            <article class="restaurant-directory-card">
                <div class="restaurant-card-logo"><img src="${escapeHtml(imageSource(restaurant.logoPath))}" alt="${escapeHtml(restaurant.name)} logo"></div>
                <div class="restaurant-card-content">
                    <span class="restaurant-open-badge">${restaurant.deliveryAvailable ? "Delivery available" : "Pickup only"}</span>
                    <h2>${escapeHtml(restaurant.name)}</h2>
                    <p>${escapeHtml(restaurant.address || "Address coming soon")}</p>
                    <dl><div><dt>Opening hours</dt><dd>${escapeHtml(formatHours(restaurant))}</dd></div><div><dt>Rating</dt><dd>New on HungerStation</dd></div></dl>
                    <a href="index.html?restaurantId=${encodeURIComponent(restaurant.id)}">View Menu</a>
                </div>
            </article>`).join("") || '<p class="directory-empty">No restaurant matches that search yet.</p>';
    }

    async function loadRestaurants() {
        try {
            const response = await fetch("/api/restaurants");
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || "Could not load restaurants.");
            restaurants = data.restaurants || [];
            render();
        } catch (error) {
            listEl.innerHTML = `<p class="directory-empty">${escapeHtml(error.message)}</p>`;
        }
    }

    searchEl.addEventListener("input", render);
    loadRestaurants();
});
