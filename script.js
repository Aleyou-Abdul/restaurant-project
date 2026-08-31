document.addEventListener("DOMContentLoaded", () => {
    const cartCountEl = document.getElementById("cart-count");
    const heroSliderEl = document.getElementById("hero-slider");
    const heroSliderDotsEl = document.getElementById("hero-slider-dots");
    const trendingItemsEl = document.getElementById("trending-items");
    const categoryBarEl = document.getElementById("menu-categories");
    const menuItemsEl = document.getElementById("menu-items");
    const toastEl = document.getElementById("site-toast");

    let siteDataCache = {
        site: {},
        categories: [],
        menuItems: []
    };
    let selectedCategory = "All";
    let heroSlidesIntervalId = null;
    let heroSlideIndex = 0;
    let closingCountdownIntervalId = null;
    let orderWindowState = { canOrder: true, isWithinCountdown: false };
    let isHomeVendorStorefront = false;

    function parsePrice(value) {
        return Number(String(value).replace(/[^\d]/g, "")) || 0;
    }

    function formatPrice(amount) {
        return `\u20A6${amount}`;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function getSafeImageSrc(value) {
        const trimmedValue = String(value || "").trim();
        return /^(?:https?:\/\/|\/|\.\/|images\/)/i.test(trimmedValue) ? trimmedValue : "images/menu-placeholder.svg";
    }

    async function fetchJson(url, options) {
        const response = await fetch(withRestaurantContext(url), options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Request failed.");
        }

        return data;
    }

    function getRestaurantContextId() {
        const query = new URLSearchParams(window.location.search);
        const fromUrl = String(query.get("restaurantId") || query.get("restaurant") || "").trim();
        const fromStorage = String(localStorage.getItem("hungerstation.restaurantId") || "").trim();
        return fromUrl || fromStorage || "";
    }

    function syncRestaurantContext(restaurantId) {
        const normalizedId = String(restaurantId || "").trim();

        if (normalizedId) {
            localStorage.setItem("hungerstation.restaurantId", normalizedId);
        }
    }

    function getCartStorageKey() {
        return `hungerstation.cart:${getRestaurantContextId() || "hungerstation-default"}`;
    }

    function updateRestaurantLinks() {
        document.querySelectorAll("[data-restaurant-link]").forEach((link) => {
            link.href = withRestaurantContext(link.getAttribute("href") || "cart.html");
        });
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

    function normalizeCart(rawCart) {
        if (!Array.isArray(rawCart)) {
            return [];
        }

        return rawCart
            .filter((item) => item && item.name)
            .map((item) => ({
                id: String(item.id || item.name || ""),
                name: String(item.name),
                price: parsePrice(item.price),
                quantity: Math.max(1, Number(item.quantity || 1))
            }));
    }

    function getCart() {
        try {
            const storageKey = getCartStorageKey();
            const storedCart = localStorage.getItem(storageKey);
            // Preserve the existing single-restaurant cart during the migration.
            const legacyCart = storageKey.endsWith("hungerstation-default") ? localStorage.getItem("cart") : null;
            return normalizeCart(JSON.parse(storedCart || legacyCart || "[]"));
        } catch (error) {
            return [];
        }
    }

    function saveCart(cart) {
        localStorage.setItem(getCartStorageKey(), JSON.stringify(cart));
    }

    function updateCartCount() {
        const count = getCart().reduce((total, item) => total + item.quantity, 0);

        if (cartCountEl) {
            cartCountEl.textContent = count;
        }
    }

    function showToast(message) {
        toastEl.textContent = message;
        toastEl.classList.add("is-visible");

        window.clearTimeout(showToast.timeoutId);
        showToast.timeoutId = window.setTimeout(() => {
            toastEl.classList.remove("is-visible");
        }, 2200);
    }

    function addMealToCart(menuItem) {
        const cart = getCart();
        const existingMeal = cart.find((item) => item.id === menuItem.id || item.name === menuItem.name);
        const availableStock = Number.isFinite(menuItem.stockQuantity) ? Number(menuItem.stockQuantity) : null;

        if (menuItem.availability === "out-of-stock" || menuItem.availability === "hidden") {
            showToast(`${menuItem.name} is not available right now.`);
            return;
        }

        if (existingMeal) {
            if (availableStock !== null && existingMeal.quantity >= availableStock) {
                showToast(`Only ${availableStock} ${menuItem.name} left right now.`);
                return;
            }
            existingMeal.quantity += 1;
        } else {
            if (availableStock === 0) {
                showToast(`${menuItem.name} is not available right now.`);
                return;
            }
            cart.push({
                id: menuItem.id,
                name: menuItem.name,
                price: menuItem.price,
                quantity: 1
            });
        }

        saveCart(cart);
        updateCartCount();
        showToast(`${menuItem.name} added to cart`);
    }

    function revealFadeElements() {
        document.querySelectorAll(".fade-in").forEach((element) => {
            const top = element.getBoundingClientRect().top;
            const windowHeight = window.innerHeight;

            if (top < windowHeight - 100) {
                element.classList.add("show");
            }
        });
    }

    function getHeroSlides(site, menuItems) {
        const configuredSlides = Array.isArray(site.heroSlides) ? site.heroSlides.filter(Boolean).slice(0, 3) : [];

        if (configuredSlides.length) {
            return configuredSlides;
        }

        // Fall back to menu images so the hero never looks broken on a fresh setup.
        return (menuItems || [])
            .map((item) => item.image)
            .filter(Boolean)
            .slice(0, 3);
    }

    function stopHeroSlider() {
        window.clearInterval(heroSlidesIntervalId);
        heroSlidesIntervalId = null;
    }

    function stopClosingCountdown() {
        window.clearInterval(closingCountdownIntervalId);
        closingCountdownIntervalId = null;
    }

    function renderHeroSlides(slides) {
        heroSliderEl.innerHTML = "";
        heroSliderDotsEl.innerHTML = "";
        stopHeroSlider();

        if (!slides.length) {
            heroSliderEl.innerHTML = '<div class="hero-slide is-active"><div class="hero-slide-placeholder">Upload hero images from admin</div></div>';
            return;
        }

        heroSlideIndex = 0;

        slides.forEach((slide, index) => {
            const slideEl = document.createElement("div");
            slideEl.className = `hero-slide${index === 0 ? " is-active" : ""}`;
            slideEl.innerHTML = `<img src="${escapeHtml(getSafeImageSrc(slide))}" alt="Hero slider image ${index + 1}">`;
            heroSliderEl.appendChild(slideEl);

            const dotEl = document.createElement("button");
            dotEl.type = "button";
            dotEl.className = `hero-slider-dot${index === 0 ? " is-active" : ""}`;
            dotEl.setAttribute("aria-label", `Show slide ${index + 1}`);
            dotEl.addEventListener("click", () => {
                heroSlideIndex = index;
                updateHeroSlider(slides);
            });
            heroSliderDotsEl.appendChild(dotEl);
        });

        if (slides.length > 1) {
            heroSlidesIntervalId = window.setInterval(() => {
                heroSlideIndex = (heroSlideIndex + 1) % slides.length;
                updateHeroSlider(slides);
            }, 4000);
        }
    }

    function updateHeroSlider(slides) {
        [...heroSliderEl.children].forEach((slideEl, index) => {
            slideEl.classList.toggle("is-active", index === heroSlideIndex);
        });

        [...heroSliderDotsEl.children].forEach((dotEl, index) => {
            dotEl.classList.toggle("is-active", index === heroSlideIndex);
        });
    }

    function formatCountdownTime(totalSeconds) {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    function parseTimeToDate(timeValue) {
        const match = String(timeValue || "").match(/^(\d{2}):(\d{2})$/);

        if (!match) {
            return null;
        }

        const date = new Date();
        date.setHours(Number(match[1]), Number(match[2]), 0, 0);
        return date;
    }

    function formatTimeLabel(timeValue) {
        const date = parseTimeToDate(timeValue);

        if (!date) {
            return "";
        }

        return new Intl.DateTimeFormat("en-NG", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true
        }).format(date);
    }

    function getOrderingWindowState(site) {
        if (isHomeVendorStorefront) {
            return {
                canOrder: true,
                isWithinCountdown: false,
                isClosed: false,
                secondsToClose: null,
                statusText: "",
                hoursText: "",
                opensAtText: ""
            };
        }

        const opening = parseTimeToDate(site.openingTime);
        const closing = parseTimeToDate(site.closingTime);

        if (!opening || !closing) {
            return {
                canOrder: true,
                isWithinCountdown: false,
                isClosed: false,
                secondsToClose: null,
                statusText: "Ordering is available now.",
                hoursText: "",
                opensAtText: ""
            };
        }

        const now = new Date();
        const openingTime = new Date(opening);
        const closingTime = new Date(closing);

        if (closingTime <= openingTime) {
            if (now < closingTime) {
                openingTime.setDate(openingTime.getDate() - 1);
            } else {
                closingTime.setDate(closingTime.getDate() + 1);
            }
        }

        const canOrder = now >= openingTime && now < closingTime;
        const secondsToClose = canOrder ? Math.max(0, Math.floor((closingTime - now) / 1000)) : null;
        const isWithinCountdown = canOrder && secondsToClose <= 1800;
        const opensAtText = formatTimeLabel(site.openingTime);
        const closesAtText = formatTimeLabel(site.closingTime);

        return {
            canOrder,
            isWithinCountdown,
            isClosed: !canOrder,
            secondsToClose,
            statusText: canOrder
                ? `Open now. Closing at ${closesAtText}.`
                : `Ordering is closed now. Opens at ${opensAtText}.`,
            hoursText: opensAtText && closesAtText ? `Open daily: ${opensAtText} - ${closesAtText}` : "",
            opensAtText
        };
    }

    function renderClosingCountdown(site) {
        const cardEl = document.getElementById("hero-countdown-card");
        const titleEl = document.getElementById("hero-countdown-title");
        const subtitleEl = document.getElementById("hero-countdown-subtitle");
        const currentOrderWindow = getOrderingWindowState(site);

        stopClosingCountdown();
        cardEl.classList.remove("is-warning", "is-closed");

        if (isHomeVendorStorefront) {
            titleEl.textContent = "Pre-order";
            subtitleEl.textContent = "Each offer has its own deadline";
            return;
        }

        if (!currentOrderWindow.canOrder) {
            titleEl.textContent = "Closed";
            subtitleEl.textContent = currentOrderWindow.opensAtText
                ? `Opens at ${currentOrderWindow.opensAtText}`
                : "Ordering unavailable";
            cardEl.classList.add("is-closed");
            return;
        }

        if (!currentOrderWindow.isWithinCountdown) {
            titleEl.textContent = "Easy";
            subtitleEl.textContent = "Receipt-ready orders";
            return;
        }

        function updateCountdown() {
            const refreshedState = getOrderingWindowState(site);
            const secondsLeft = refreshedState.secondsToClose || 0;

            if (!refreshedState.canOrder || !secondsLeft) {
                titleEl.textContent = "Closed";
                subtitleEl.textContent = "Ordering window ended";
                cardEl.classList.remove("is-warning");
                cardEl.classList.add("is-closed");
                stopClosingCountdown();
                return;
            }

            titleEl.textContent = formatCountdownTime(secondsLeft);
            subtitleEl.textContent = "Ordering closes soon";
            cardEl.classList.toggle("is-warning", secondsLeft <= 300);
            cardEl.classList.remove("is-closed");
        }

        updateCountdown();
        closingCountdownIntervalId = window.setInterval(updateCountdown, 1000);
    }

    function createMenuCard(item) {
        const card = document.createElement("div");
        const isUnavailable = item.availability === "out-of-stock" || item.availability === "hidden";
        const isLowStock = item.availability === "low-stock";
        const buttonLabel = !orderWindowState.canOrder
            ? "Ordering Closed"
            : isUnavailable
                ? "Not Available"
                : "Add to Cart";
        const stockBadge = isUnavailable
            ? '<span class="meal-stock-badge is-out">Not available now</span>'
            : isLowStock
                ? `<span class="meal-stock-badge is-low">${escapeHtml(item.stockQuantity ? `Only ${item.stockQuantity} left` : "Low stock")}</span>`
                : item.stockQuantity !== null && item.stockQuantity !== undefined
                    ? `<span class="meal-stock-badge is-available">${escapeHtml(`${item.stockQuantity} left`)}</span>`
                    : '<span class="meal-stock-badge is-available">Available</span>';
        const scheduleMessage = getOfferScheduleMessage(item);
        card.className = `${isHomeVendorStorefront ? "vendor-offer-card" : "meal"} fade-in`;
        card.dataset.menuItemId = String(item.id || "");
        if (isHomeVendorStorefront) {
            card.innerHTML = `
                <button class="vendor-offer-open" type="button" aria-label="View ${escapeHtml(item.name)} details">
                    <img src="${escapeHtml(getSafeImageSrc(item.image))}" alt="${escapeHtml(item.name)}">
                    <span class="vendor-offer-badge">${escapeHtml(item.category || "Today's special")}</span>
                    <span class="vendor-offer-price">${formatPrice(item.price)}</span>
                </button>
                <div class="vendor-offer-content">
                    <h3>${escapeHtml(item.name)}</h3>
                    <p>${escapeHtml(scheduleMessage || "Freshly made today. Tap to see the full offer.")}</p>
                    <button class="vendor-offer-details" type="button">View offer</button>
                </div>
            `;
            card.querySelectorAll(".vendor-offer-open, .vendor-offer-details").forEach((button) => {
                button.addEventListener("click", () => openVendorOffer(item));
            });
            return card;
        }

        card.innerHTML = `
            <div class="meal-media">
                <img src="${escapeHtml(getSafeImageSrc(item.image))}" alt="${escapeHtml(item.name)}">
                <span class="meal-price-tag">${formatPrice(item.price)}</span>
            </div>
            <div class="meal-content">
                <div class="meal-meta">
                    <span class="meal-category-tag">${escapeHtml(item.category || "Menu")}</span>
                    ${stockBadge}
                </div>
                <h3>${escapeHtml(item.name)}</h3>
                <p>${escapeHtml(scheduleMessage || "Freshly prepared and ready for quick delivery.")}</p>
                <div class="meal-actions">
                    <button class="add-to-cart" type="button" ${orderWindowState.canOrder && !isUnavailable ? "" : "disabled"}>${escapeHtml(buttonLabel)}</button>
                    <a href="cart.html">View Cart</a>
                </div>
            </div>
        `;

        card.querySelector(".add-to-cart").addEventListener("click", () => {
            if (!orderWindowState.canOrder) {
                showToast("Ordering is closed right now.");
                return;
            }
            addMealToCart(item);
        });

        return card;
    }

    function openVendorOffer(item) {
        const existingModal = document.getElementById("vendor-offer-modal");
        if (existingModal) existingModal.remove();

        const isUnavailable = item.availability === "out-of-stock" || item.availability === "hidden";
        const scheduleMessage = getOfferScheduleMessage(item);
        const modal = document.createElement("div");
        modal.id = "vendor-offer-modal";
        modal.className = "vendor-offer-modal";
        modal.innerHTML = `
            <div class="vendor-offer-modal-backdrop" data-close-vendor-modal></div>
            <section class="vendor-offer-modal-card" role="dialog" aria-modal="true" aria-labelledby="vendor-offer-modal-title">
                <button class="vendor-offer-modal-close" type="button" aria-label="Close offer" data-close-vendor-modal>&times;</button>
                <img src="${escapeHtml(getSafeImageSrc(item.image))}" alt="${escapeHtml(item.name)}">
                <div class="vendor-offer-modal-content">
                    <span>${escapeHtml(item.category || "Today's special")}</span>
                    <h2 id="vendor-offer-modal-title">${escapeHtml(item.name)}</h2>
                    <strong>${formatPrice(item.price)}</strong>
                    <p>${escapeHtml(scheduleMessage || "Prepared fresh by this home food vendor.")}</p>
                    <div class="vendor-offer-modal-actions">
                        <button type="button" class="vendor-offer-add" ${orderWindowState.canOrder && !isUnavailable ? "" : "disabled"}>${isUnavailable ? "Not Available" : orderWindowState.canOrder ? "Add to Basket" : "Ordering Closed"}</button>
                        <a href="${withRestaurantContext("cart.html")}">View Basket</a>
                    </div>
                </div>
            </section>
        `;
        document.body.appendChild(modal);
        document.body.classList.add("vendor-modal-open");

        const closeModal = () => {
            modal.remove();
            document.body.classList.remove("vendor-modal-open");
        };
        modal.querySelectorAll("[data-close-vendor-modal]").forEach((button) => button.addEventListener("click", closeModal));
        modal.querySelector(".vendor-offer-add").addEventListener("click", () => {
            if (!orderWindowState.canOrder || isUnavailable) return;
            addMealToCart(item);
            closeModal();
        });
        modal.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeModal();
        });
        modal.querySelector(".vendor-offer-modal-close").focus();
    }

    function renderCardList(container, items, emptyMessage) {
        container.innerHTML = "";

        if (!items.length) {
            container.innerHTML = `<p class="empty-cart-message">${emptyMessage}</p>`;
            return;
        }

        items.forEach((item) => {
            container.appendChild(createMenuCard(item));
        });

        revealFadeElements();
    }

    function getFilteredMenuItems() {
        const menuItems = (siteDataCache.menuItems || []).filter((item) => item.availability !== "hidden" && !hasPreorderClosed(item));

        if (selectedCategory === "All") {
            return menuItems;
        }

        return menuItems.filter((item) => item.category === selectedCategory);
    }

    // Home vendors can sell for a future date; the deadline is the only time that removes an offer from ordering.
    function hasPreorderClosed(item) {
        if (!item || !item.orderDeadline) return false;
        const deadline = new Date(item.orderDeadline).getTime();
        return Number.isFinite(deadline) && deadline <= Date.now();
    }

    function getOfferScheduleMessage(item) {
        const format = (value) => new Intl.DateTimeFormat("en-NG", {
            dateStyle: "medium",
            timeStyle: "short",
            hour12: true
        }).format(new Date(value));
        const deadline = item && item.orderDeadline ? new Date(item.orderDeadline).getTime() : NaN;
        if (Number.isFinite(deadline) && deadline > Date.now()) return `Pre-order closes ${format(item.orderDeadline)}.`;
        const availableFrom = item && item.availableFrom ? new Date(item.availableFrom).getTime() : NaN;
        if (Number.isFinite(availableFrom) && availableFrom > Date.now()) return `Available ${format(item.availableFrom)}. Pre-order now.`;
        return "";
    }

    function renderMenuItems() {
        renderCardList(
            menuItemsEl,
            getFilteredMenuItems(),
            "No meals available in this category right now."
        );
        revealRequestedMenuItem();
    }

    function getRequestedMenuItemId() {
        const query = new URLSearchParams(window.location.search);
        return String(query.get("itemId") || query.get("item") || "").trim();
    }

    function revealRequestedMenuItem() {
        const itemId = getRequestedMenuItemId();
        if (!itemId) return;

        const targetCard = [...menuItemsEl.querySelectorAll("[data-menu-item-id]")]
            .find((card) => card.dataset.menuItemId === itemId);
        if (!targetCard) return;

        // Wait for the menu layout to settle so the selected meal lands in view reliably on phones.
        window.requestAnimationFrame(() => {
            targetCard.scrollIntoView({ behavior: "smooth", block: "center" });
            targetCard.classList.add("is-menu-item-target");
            window.setTimeout(() => targetCard.classList.remove("is-menu-item-target"), 2600);
        });
    }

    function renderTrendingItems(items) {
        renderCardList(
            trendingItemsEl,
            items,
            "Trending meals will appear here after customers start ordering."
        );
    }

    function renderCategoryFilters(categories) {
        const filterOptions = ["All", ...categories];
        categoryBarEl.innerHTML = "";

        filterOptions.forEach((category) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "category-filter-btn";
            button.textContent = category;
            button.classList.toggle("is-active", category === selectedCategory);
            button.addEventListener("click", () => {
                selectedCategory = category;
                renderCategoryFilters(categories);
                renderMenuItems();
            });
            categoryBarEl.appendChild(button);
        });
    }

    function applySiteContent(data) {
        const site = data.site || {};
        const siteLogoImageEl = document.getElementById("site-logo-image");
        const siteLogoTextEl = document.getElementById("site-logo");
        const footerLogoImageEl = document.getElementById("footer-logo-image");
        isHomeVendorStorefront = data.businessType === "home-vendor";
        document.body.classList.toggle("home-vendor-storefront", isHomeVendorStorefront);
        siteDataCache = {
            site,
            categories: data.categories || [],
            menuItems: data.menuItems || []
        };

        const requestedItemId = getRequestedMenuItemId();
        const requestedItem = siteDataCache.menuItems.find((item) => String(item.id) === requestedItemId);
        if (requestedItem && requestedItem.category) {
            selectedCategory = requestedItem.category;
        }

        document.title = `${site.restaurantName || "My Restaurant"} | Order Online`;
        orderWindowState = getOrderingWindowState(site);
        siteLogoTextEl.textContent = site.restaurantName || "My Restaurant";
        if (site.logoPath) {
            siteLogoImageEl.src = site.logoPath;
            siteLogoImageEl.hidden = false;
            footerLogoImageEl.src = site.logoPath;
            footerLogoImageEl.hidden = false;
        } else {
            siteLogoImageEl.hidden = true;
            siteLogoImageEl.removeAttribute("src");
            footerLogoImageEl.hidden = true;
            footerLogoImageEl.removeAttribute("src");
        }
        document.getElementById("hero-title").textContent = site.heroTitle || "Delicious Meals Delivered Fast";
        document.getElementById("hero-subtitle").textContent = site.heroSubtitle || "Fresh, hot, and tasty dishes straight to your door.";
        document.getElementById("hero-hours").textContent = orderWindowState.hoursText;
        document.getElementById("hero-order-status").textContent = orderWindowState.statusText;
        document.getElementById("hero-order-status").className = `hero-order-status ${orderWindowState.canOrder ? "is-open" : "is-closed"}`;
        document.getElementById("footer-name").textContent = site.restaurantName || "My Restaurant";
        document.getElementById("footer-tagline").textContent = site.heroSubtitle || "Delicious meals delivered to your doorstep.";
        document.getElementById("footer-phone").textContent = site.phone || "";
        document.getElementById("footer-email").textContent = site.email || "";
        document.getElementById("footer-location").textContent = site.location || "";
        document.getElementById("footer-bottom-name").textContent = site.restaurantName || "My Restaurant";
        applyStorefrontMode(site);
        renderHeroSlides(getHeroSlides(site, siteDataCache.menuItems));
        renderClosingCountdown(site);
        renderCategoryFilters(siteDataCache.categories);
        renderMenuItems();
    }

    function applyStorefrontMode(site) {
        const heroKicker = document.querySelector(".hero-kicker");
        const menuHeading = document.querySelector("#menu .section-heading h2");
        const menuDescription = document.querySelector("#menu .section-heading p:last-child");
        const orderLink = document.querySelector(".hero-actions a:first-child");
        const cartLink = document.querySelector(".hero-secondary-link");
        const restaurantLink = document.querySelector('nav a[href="restaurants.html"]');
        const promiseLabel = document.querySelector(".hero-panel-card p");
        const promiseTitle = document.querySelector(".hero-panel-card h3");
        const metricCards = document.querySelectorAll(".hero-metrics div");

        if (!isHomeVendorStorefront) return;

        heroKicker.textContent = "HOME FOOD VENDOR · TODAY'S DROP";
        document.getElementById("hero-title").textContent = site.heroTitle || "Good food is closer than you think";
        document.getElementById("hero-subtitle").textContent = site.heroSubtitle || "Browse fresh daily offers, tap a meal, and pre-order in seconds.";
        menuHeading.textContent = "Today's offers";
        menuDescription.textContent = "Tap any offer to view the details, availability, and preorder time.";
        orderLink.textContent = "See today's offers";
        cartLink.textContent = "My basket";
        promiseLabel.textContent = "How home vendor offers work";
        promiseTitle.textContent = "Choose an offer, check its deadline, and pre-order while it is available.";
        if (metricCards.length >= 2) {
            metricCards[0].querySelector("strong").textContent = "Fresh";
            metricCards[0].querySelector("span").textContent = "Made in small batches";
            metricCards[1].querySelector("strong").textContent = "Tap";
            metricCards[1].querySelector("span").textContent = "View offer details";
        }
        if (restaurantLink) {
            restaurantLink.href = "vendors.html";
            restaurantLink.textContent = "Home Vendors";
        }
    }

    async function loadSiteData() {
        try {
            const [siteData, trendingData] = await Promise.all([
                fetchJson("/api/site-data"),
                fetchJson("/api/trending-items")
            ]);

            syncRestaurantContext(siteData.restaurantId || "");
            updateRestaurantLinks();
            applySiteContent(siteData);
            renderTrendingItems(trendingData.items || []);
            updateCartCount();
        } catch (error) {
            menuItemsEl.innerHTML = `<p class="empty-cart-message">${error.message}</p>`;
            trendingItemsEl.innerHTML = "";
        }
    }

    window.addEventListener("scroll", revealFadeElements);
    updateCartCount();
    loadSiteData();
});
