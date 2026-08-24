const assert = require("assert");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const net = require("net");
const os = require("os");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

function findAvailablePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

function waitForServer(process) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out waiting for the test server.")), 15000);
        const finish = (error) => {
            clearTimeout(timeout);
            error ? reject(error) : resolve();
        };

        process.stdout.on("data", (chunk) => {
            if (chunk.toString().includes("Server running")) finish();
        });
        process.once("error", finish);
        process.once("exit", (code) => finish(new Error(`Test server stopped unexpectedly with code ${code}.`)));
    });
}

async function request(port, route, options = {}, cookie = "") {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
            ...(options.headers || {})
        }
    });
    const data = await response.json();
    const setCookie = response.headers.get("set-cookie");
    return { status: response.status, data, cookie: setCookie ? setCookie.split(";")[0] : "" };
}

async function main() {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hungerstation-tenant-test-"));
    const port = await findAvailablePort();
    const serverProcess = spawn(process.execPath, ["server.js"], {
        cwd: rootDir,
        env: {
            ...process.env,
            PORT: String(port),
            STORAGE_ROOT: storageRoot,
            SUPER_ADMIN_USERNAME: "platform-test",
            SUPER_ADMIN_PASSWORD: "platform-test-password",
            SUPER_ADMIN_PASSWORD_HASH: ""
        },
        stdio: ["ignore", "pipe", "pipe"]
    });

    try {
        await waitForServer(serverProcess);

        const superLogin = await request(port, "/api/super-admin/login", {
            method: "POST",
            body: JSON.stringify({ username: "platform-test", password: "platform-test-password" })
        });
        assert.equal(superLogin.status, 200, "Super Admin login should succeed.");

        const createRestaurant = async (name, username, businessType = "restaurant") => {
            const response = await request(port, "/api/super-admin/restaurants", {
                method: "POST",
                body: JSON.stringify({ name, businessType, adminUsername: username, adminPassword: "restaurant-password" })
            }, superLogin.cookie);
            assert.equal(response.status, 201, `${name} should be created.`);

            const activate = await request(port, "/api/super-admin/restaurants/status", {
                method: "POST",
                body: JSON.stringify({ restaurantId: response.data.restaurant.id, status: "active" })
            }, superLogin.cookie);
            assert.equal(activate.status, 200, `${name} should be approved.`);
            return response.data.restaurant;
        };

        const restaurantA = await createRestaurant("Tenant A Kitchen", "tenant-a-admin");
        const restaurantB = await createRestaurant("Tenant B Kitchen", "tenant-b-admin", "home-vendor");
        assert.equal(restaurantB.businessType, "home-vendor", "Home Food Vendor type should be saved during onboarding.");

        const vendorAdminLogin = await request(port, `/api/admin/login?restaurantId=${encodeURIComponent(restaurantB.id)}`, {
            method: "POST",
            body: JSON.stringify({ username: "tenant-b-admin", password: "restaurant-password", restaurantId: restaurantB.id })
        });
        assert.equal(vendorAdminLogin.status, 200, "Home Food Vendor admin login should succeed.");
        assert.equal(vendorAdminLogin.data.businessType, "home-vendor", "Vendor login should identify the vendor workspace.");

        const vendorAdminSession = await request(port, `/api/admin/session?restaurantId=${encodeURIComponent(restaurantB.id)}`, {}, vendorAdminLogin.cookie);
        assert.equal(vendorAdminSession.data.businessType, "home-vendor", "Vendor session should retain the vendor workspace type.");

        const adminALogin = await request(port, `/api/admin/login?restaurantId=${encodeURIComponent(restaurantA.id)}`, {
            method: "POST",
            body: JSON.stringify({ username: "tenant-a-admin", password: "restaurant-password", restaurantId: restaurantA.id })
        });
        assert.equal(adminALogin.status, 200, "Tenant A admin login should succeed.");

        const tenantAMenuSave = await request(port, `/api/site-data?restaurantId=${encodeURIComponent(restaurantA.id)}`, {
            method: "POST",
            body: JSON.stringify({
                site: {
                    restaurantName: "Tenant A Kitchen",
                    logoPath: "images/tenant-a-logo.png",
                    openingTime: "10:30",
                    closingTime: "23:00"
                },
                categories: ["Food"],
                menuItems: [{
                    id: "tenant-a-only-meal",
                    name: "Tenant A Only Meal",
                    price: 2500,
                    image: "images/menu-placeholder.svg",
                    category: "Food",
                    availability: "available"
                }],
                deliveryZones: []
            })
        }, adminALogin.cookie);
        assert.equal(tenantAMenuSave.status, 200, "Tenant A admin should be able to save its own menu.");

        const crossTenantOrders = await request(port, `/api/orders?restaurantId=${encodeURIComponent(restaurantB.id)}`, {}, adminALogin.cookie);
        assert.equal(crossTenantOrders.status, 401, "Tenant A admin must not read Tenant B orders.");

        const crossTenantUsers = await request(port, `/api/admin/users?restaurantId=${encodeURIComponent(restaurantB.id)}`, {}, adminALogin.cookie);
        assert.equal(crossTenantUsers.status, 401, "Tenant A admin must not read Tenant B staff.");

        const crossTenantSave = await request(port, `/api/site-data?restaurantId=${encodeURIComponent(restaurantB.id)}`, {
            method: "POST",
            body: JSON.stringify({ site: { restaurantName: "Unauthorized change" }, categories: [], menuItems: [], deliveryZones: [] })
        }, adminALogin.cookie);
        assert.equal(crossTenantSave.status, 401, "Tenant A admin must not change Tenant B settings.");

        const tenantBPublicData = await request(port, `/api/site-data?restaurantId=${encodeURIComponent(restaurantB.id)}`);
        assert.equal(tenantBPublicData.status, 200, "Approved restaurant menus remain publicly viewable.");
        assert.equal(tenantBPublicData.data.site.restaurantName, "Tenant B Kitchen", "Cross-tenant save must not alter Tenant B data.");
        assert.deepEqual(tenantBPublicData.data.menuItems, [], "A new restaurant must not inherit demo menu items.");
        assert.equal(
            tenantBPublicData.data.menuItems.some((item) => item.name === "Tenant A Only Meal"),
            false,
            "Tenant A menu items must never appear in Tenant B."
        );

        const vendorOfferSave = await request(port, `/api/site-data?restaurantId=${encodeURIComponent(restaurantB.id)}`, {
            method: "POST",
            body: JSON.stringify({
                site: { restaurantName: "Tenant B Kitchen" },
                categories: ["Snacks"],
                menuItems: [
                    {
                        id: "vendor-preorder-open",
                        name: "Tomorrow's Fura",
                        price: 1200,
                        image: "images/menu-placeholder.svg",
                        category: "Snacks",
                        availability: "available",
                        availableFrom: "2099-01-02T12:00",
                        orderDeadline: "2099-01-01T18:00"
                    },
                    {
                        id: "vendor-preorder-closed",
                        name: "Closed Shawarma Offer",
                        price: 1500,
                        image: "images/menu-placeholder.svg",
                        category: "Snacks",
                        availability: "available",
                        orderDeadline: "2000-01-01T18:00"
                    }
                ],
                deliveryZones: []
            })
        }, vendorAdminLogin.cookie);
        assert.equal(vendorOfferSave.status, 200, "Vendor admin should save scheduled offers.");

        const vendorFoodSearch = await request(port, "/api/food-search");
        assert.equal(
            vendorFoodSearch.data.items.some((item) => item.id === "vendor-preorder-open" && item.availableFrom && item.orderDeadline),
            true,
            "An open vendor preorder should appear in public food search with its schedule."
        );
        assert.equal(
            vendorFoodSearch.data.items.some((item) => item.id === "vendor-preorder-closed"),
            false,
            "An expired vendor preorder must not appear in public food search."
        );

        const publicRestaurants = await request(port, "/api/restaurants");
        const publicRestaurantA = publicRestaurants.data.restaurants.find((restaurant) => restaurant.id === restaurantA.id);
        const publicRestaurantB = publicRestaurants.data.restaurants.find((restaurant) => restaurant.id === restaurantB.id);
        assert.equal(publicRestaurantA.openingTime, "10:30", "Restaurant Admin opening time should update its public listing.");
        assert.equal(publicRestaurantA.closingTime, "23:00", "Restaurant Admin closing time should update its public listing.");
        assert.equal(publicRestaurantA.logoPath, "images/tenant-a-logo.png", "Restaurant Admin logo should update its public listing.");
        assert.equal(publicRestaurantB.businessType, "home-vendor", "Public directory should retain the business type.");

        console.log("Tenant isolation check passed.");
    } finally {
        serverProcess.kill();
        if (serverProcess.exitCode === null) {
            await new Promise((resolve) => serverProcess.once("exit", resolve));
        }
        await fs.rm(storageRoot, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
