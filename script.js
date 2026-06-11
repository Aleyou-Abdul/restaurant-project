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
        const response = await fetch(url, options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Request failed.");
        }

        return data;
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
            return normalizeCart(JSON.parse(localStorage.getItem("cart")) || []);
        } catch (error) {
            return [];
        }
    }

    function saveCart(cart) {
        localStorage.setItem("cart", JSON.stringify(cart));
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
        card.className = "meal fade-in";
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
                <p>Freshly prepared and ready for quick delivery.</p>
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
        const menuItems = (siteDataCache.menuItems || []).filter((item) => item.availability !== "hidden");

        if (selectedCategory === "All") {
            return menuItems;
        }

        return menuItems.filter((item) => item.category === selectedCategory);
    }

    function renderMenuItems() {
        renderCardList(
            menuItemsEl,
            getFilteredMenuItems(),
            "No meals available in this category right now."
        );
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
        siteDataCache = {
            site,
            categories: data.categories || [],
            menuItems: data.menuItems || []
        };

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
        renderHeroSlides(getHeroSlides(site, siteDataCache.menuItems));
        renderClosingCountdown(site);
        renderCategoryFilters(siteDataCache.categories);
        renderMenuItems();
    }

    async function loadSiteData() {
        try {
            const [siteData, trendingData] = await Promise.all([
                fetchJson("/api/site-data"),
                fetchJson("/api/trending-items")
            ]);

            applySiteContent(siteData);
            renderTrendingItems(trendingData.items || []);
        } catch (error) {
            menuItemsEl.innerHTML = `<p class="empty-cart-message">${error.message}</p>`;
            trendingItemsEl.innerHTML = "";
        }
    }

    window.addEventListener("scroll", revealFadeElements);
    updateCartCount();
    loadSiteData();
});
