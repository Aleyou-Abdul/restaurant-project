document.addEventListener("DOMContentLoaded", () => {
    const listEl = document.getElementById("restaurant-directory-list");
    const countEl = document.getElementById("restaurant-count");
    const searchToggleEl = document.getElementById("platform-search-toggle");
    const searchPanelEl = document.getElementById("platform-search-panel");
    const searchEl = document.getElementById("platform-search-input");
    const foodListEl = document.getElementById("food-directory-list");
    const foodCountEl = document.getElementById("food-count");
    const foodCategoryFiltersEl = document.getElementById("food-category-filters");
    const platformTrendingListEl = document.getElementById("platform-trending-list");
    const trendingCountEl = document.getElementById("trending-count");
    let restaurants = [];
    let foodItems = [];
    let foodCategories = [];
    let selectedFoodCategory = "All";

    function wait(milliseconds) {
        return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    }

    // Free demo hosts can briefly refuse requests while waking; retry public data before showing an error.
    async function fetchPublicApi(path) {
        let lastError;
        const retryDelays = [0, 1500, 4000];

        for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
            if (retryDelays[attempt]) await wait(retryDelays[attempt]);

            try {
                const response = await fetch(path, { cache: "no-store" });
                const data = await response.json();
                if (!response.ok) throw new Error(data.message || "Could not load HungerStation data.");
                return data;
            } catch (error) {
                lastError = error;
            }
        }

        throw new Error(lastError && lastError.message !== "Failed to fetch"
            ? lastError.message
            : "HungerStation is temporarily unavailable. Please refresh in a moment.");
    }

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

    function formatPrice(value) {
        return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(Number(value || 0));
    }

    function getItemMenuLink(item) {
        const restaurantId = encodeURIComponent(item.restaurantId);
        const itemId = encodeURIComponent(item.id || item.name);
        return `index.html?restaurantId=${restaurantId}&itemId=${itemId}#menu`;
    }

    function renderFoodCategories() {
        const categories = ["All", ...foodCategories];
        foodCategoryFiltersEl.innerHTML = categories.map((category) => (
            `<button type="button" class="directory-category-btn${category === selectedFoodCategory ? " is-active" : ""}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
        )).join("");
    }

    function renderFood() {
        const query = searchEl.value.trim().toLowerCase();
        const matches = foodItems.filter((item) => {
            const matchesCategory = selectedFoodCategory === "All" || item.category === selectedFoodCategory;
            const matchesQuery = !query || `${item.name} ${item.category} ${item.restaurantName}`.toLowerCase().includes(query);
            return matchesCategory && matchesQuery;
        });
        foodCountEl.textContent = `${matches.length} meal${matches.length === 1 ? "" : "s"}`;
        foodListEl.innerHTML = matches.map((item) => `
            <article class="food-directory-card">
                <img src="${escapeHtml(imageSource(item.image))}" alt="${escapeHtml(item.name)}">
                <div>
                    <span>${escapeHtml(item.restaurantName)}</span>
                    <h3>${escapeHtml(item.name)}</h3>
                    <p>${escapeHtml(item.category)} · Ready in about ${Number(item.preparationMinutes || 25)} mins</p>
                    <div class="food-directory-card-footer"><strong>${formatPrice(item.price)}</strong><a href="${getItemMenuLink(item)}">Order Now</a></div>
                </div>
            </article>`).join("") || '<p class="directory-empty">No meals match that search yet.</p>';
    }

    function renderPlatformTrending(items) {
        trendingCountEl.textContent = `${items.length} popular meal${items.length === 1 ? "" : "s"}`;
        platformTrendingListEl.innerHTML = items.map((item) => `
            <article class="food-directory-card platform-trending-card">
                <img src="${escapeHtml(imageSource(item.image))}" alt="${escapeHtml(item.name)}">
                <div>
                    <span>${escapeHtml(item.restaurantName)}</span>
                    <h3>${escapeHtml(item.name)}</h3>
                    <p>${Number(item.orderCount)} order${Number(item.orderCount) === 1 ? "" : "s"} this week · ${escapeHtml(item.category)}</p>
                    <div class="food-directory-card-footer"><strong>${formatPrice(item.price)}</strong><a href="${getItemMenuLink(item)}">Order Now</a></div>
                </div>
            </article>`).join("") || '<p class="directory-empty">Trending meals will appear here after customers place orders this week.</p>';
    }

    async function loadRestaurants() {
        try {
            const data = await fetchPublicApi("/api/restaurants");
            restaurants = data.restaurants || [];
            render();
        } catch (error) {
            listEl.innerHTML = `<p class="directory-empty">${escapeHtml(error.message)}</p>`;
        }
    }

    async function loadFood() {
        try {
            const data = await fetchPublicApi("/api/food-search");
            foodItems = data.items || [];
            foodCategories = data.categories || [];
            renderFoodCategories();
            renderFood();
        } catch (error) {
            foodListEl.innerHTML = `<p class="directory-empty">${escapeHtml(error.message)}</p>`;
        }
    }

    async function loadPlatformTrending() {
        try {
            const data = await fetchPublicApi("/api/platform/trending-items");
            renderPlatformTrending(data.items || []);
        } catch (error) {
            platformTrendingListEl.innerHTML = `<p class="directory-empty">${escapeHtml(error.message)}</p>`;
        }
    }

    // Keep search out of the way until a customer asks for it, especially on mobile.
    searchToggleEl.addEventListener("click", () => {
        const isOpening = searchPanelEl.hidden;
        searchPanelEl.hidden = !isOpening;
        searchToggleEl.setAttribute("aria-expanded", String(isOpening));
        if (isOpening) searchEl.focus();
    });
    searchEl.addEventListener("input", () => {
        render();
        renderFood();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || searchPanelEl.hidden) return;
        searchPanelEl.hidden = true;
        searchToggleEl.setAttribute("aria-expanded", "false");
        searchToggleEl.focus();
    });
    foodCategoryFiltersEl.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-category]");
        if (!button) return;
        selectedFoodCategory = button.dataset.category;
        renderFoodCategories();
        renderFood();
    });
    loadRestaurants();
    loadFood();
    loadPlatformTrending();
});
