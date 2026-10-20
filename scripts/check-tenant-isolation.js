const assert = require("assert");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const net = require("net");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");

const rootDir = path.resolve(__dirname, "..");
let testServerErrorOutput = "";

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
    let response;
    try {
        response = await fetch(`http://localhost:${port}${route}`, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(cookie ? { Cookie: cookie } : {}),
                ...(options.headers || {})
            }
        });
    } catch (error) {
        const serverDetails = testServerErrorOutput.trim();
        throw new Error(`Request to ${route} failed: ${error.message}${serverDetails ? `\nTest server error: ${serverDetails}` : ""}`);
    }
    const data = await response.json();
    const setCookie = response.headers.get("set-cookie");
    return { status: response.status, data, cookie: setCookie ? setCookie.split(";")[0] : "" };
}

function insertOrderFixture(databaseFile, order) {
    return new Promise((resolve, reject) => {
        const database = new sqlite3.Database(databaseFile, (openError) => {
            if (openError) reject(openError);
        });
        const createdAt = order.date || new Date().toISOString();

        database.run(
            `INSERT INTO orders (reference, payload, paid_at, created_at, status, restaurant_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                order.reference,
                JSON.stringify(order),
                order.paidAt || createdAt,
                createdAt,
                order.status || "Paid",
                order.restaurantId
            ],
            (insertError) => {
                database.close((closeError) => {
                    if (insertError || closeError) {
                        reject(insertError || closeError);
                        return;
                    }
                    resolve();
                });
            }
        );
    });
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
            SUPER_ADMIN_PASSWORD_HASH: "",
            HOME_VENDOR_DEMO_NAME: "Test Home Food Demo",
            HOME_VENDOR_DEMO_ADMIN_USERNAME: "vendor-demo-test",
            HOME_VENDOR_DEMO_ADMIN_PASSWORD: "vendor-demo-password"
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    serverProcess.stderr.on("data", (chunk) => {
        testServerErrorOutput += chunk.toString();
    });

    try {
        await waitForServer(serverProcess);

        const demoVendorPublicData = await request(port, "/api/site-data?restaurantId=hungerstation-demo-vendor");
        assert.equal(demoVendorPublicData.status, 200, "Configured demo vendor should be publicly available.");
        assert.equal(demoVendorPublicData.data.site.restaurantName, "Test Home Food Demo", "Demo vendor should use its configured name.");
        assert.equal(demoVendorPublicData.data.menuItems.length, 2, "Demo vendor should have sample offers.");

        const demoVendorLogin = await request(port, "/api/admin/login?restaurantId=hungerstation-demo-vendor", {
            method: "POST",
            body: JSON.stringify({ username: "vendor-demo-test", password: "vendor-demo-password", restaurantId: "hungerstation-demo-vendor" })
        });
        assert.equal(demoVendorLogin.status, 200, "Configured demo vendor admin should be able to sign in.");
        assert.equal(demoVendorLogin.data.businessType, "home-vendor", "Demo vendor login should open the Vendor Studio.");

        const superLogin = await request(port, "/api/super-admin/login", {
            method: "POST",
            body: JSON.stringify({ username: "platform-test", password: "platform-test-password" })
        });
        assert.equal(superLogin.status, 200, "Super Admin login should succeed.");

        const createRestaurant = async (name, username, businessType = "restaurant") => {
            const application = await request(port, "/api/business-applications", {
                method: "POST",
                body: JSON.stringify({
                    name,
                    businessType,
                    ownerName: `${name} Owner`,
                    phone: "+2348000000000",
                    ownerPhone: "+2348000000000",
                    email: `${username}@example.test`,
                    address: "1 Test Street",
                    country: "Nigeria",
                    state: "Kaduna",
                    localGovernment: "Kaduna North",
                    applicationNote: "A verified test business for tenant isolation checks.",
                    adminUsername: username,
                    adminPassword: "restaurant-password",
                    acceptedTerms: "on"
                })
            });
            assert.equal(application.status, 201, `${name} application should be received.`);

            const bootstrap = await request(port, "/api/super-admin/bootstrap", {}, superLogin.cookie);
            assert.equal(bootstrap.status, 200, "Super Admin should be able to review applications.");
            const restaurant = bootstrap.data.restaurants.find((item) => item.name === name);
            assert.ok(restaurant, `${name} should appear in the Super Admin review list.`);
            assert.equal(restaurant.status, "pending", `${name} should begin as pending.`);
            assert.equal(restaurant.approved, false, `${name} must not be public before approval.`);

            const pendingPublicRequest = await request(port, `/api/site-data?restaurantId=${encodeURIComponent(restaurant.id)}`);
            assert.equal(pendingPublicRequest.status, 403, `${name} should not be visible to customers before approval.`);

            const pendingAdminLogin = await request(port, `/api/admin/login?restaurantId=${encodeURIComponent(restaurant.id)}`, {
                method: "POST",
                body: JSON.stringify({ username, password: "restaurant-password", restaurantId: restaurant.id })
            });
            assert.equal(pendingAdminLogin.status, 403, `${name} admin should remain locked before approval.`);

            const activate = await request(port, "/api/super-admin/restaurants/status", {
                method: "POST",
                body: JSON.stringify({ restaurantId: restaurant.id, status: "active" })
            }, superLogin.cookie);
            assert.equal(activate.status, 200, `${name} should be approved by Super Admin.`);
            return restaurant;
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

        const createStaffUser = async (username, displayName) => {
            const response = await request(port, `/api/admin/users?restaurantId=${encodeURIComponent(restaurantA.id)}`, {
                method: "POST",
                body: JSON.stringify({ username, displayName, password: "staff-password" })
            }, adminALogin.cookie);
            assert.equal(response.status, 200, `${displayName} should be created as Tenant A staff.`);
        };

        await createStaffUser("tenant-a-staff-one", "Staff One");
        await createStaffUser("tenant-a-staff-two", "Staff Two");

        const staffOneLogin = await request(port, `/api/staff/login?restaurantId=${encodeURIComponent(restaurantA.id)}`, {
            method: "POST",
            body: JSON.stringify({
                username: "tenant-a-staff-one",
                password: "staff-password",
                restaurantId: restaurantA.id
            })
        });
        const staffTwoLogin = await request(port, `/api/staff/login?restaurantId=${encodeURIComponent(restaurantA.id)}`, {
            method: "POST",
            body: JSON.stringify({
                username: "tenant-a-staff-two",
                password: "staff-password",
                restaurantId: restaurantA.id
            })
        });
        assert.equal(staffOneLogin.status, 200, "Staff One should be able to log in.");
        assert.equal(staffTwoLogin.status, 200, "Staff Two should be able to log in.");

        const orderReference = "tenant-a-order-acceptance-test";
        await insertOrderFixture(path.join(storageRoot, "restaurant.db"), {
            reference: orderReference,
            restaurantId: restaurantA.id,
            status: "Paid",
            paymentStatus: "paid",
            customerPhone: "+2348000000000",
            deliveryArea: "Test area",
            fulfillmentType: "pickup",
            total: 2500,
            items: [{ id: "tenant-a-only-meal", name: "Tenant A Only Meal", price: 2500, quantity: 1 }],
            date: new Date().toISOString(),
            paidAt: new Date().toISOString()
        });

        const acceptOrder = (cookie) => request(port, `/api/staff/orders/status?restaurantId=${encodeURIComponent(restaurantA.id)}`, {
            method: "POST",
            body: JSON.stringify({ reference: orderReference, status: "Accepted" })
        }, cookie);
        const [firstAccept, secondAccept] = await Promise.all([
            acceptOrder(staffOneLogin.cookie),
            acceptOrder(staffTwoLogin.cookie)
        ]);
        const acceptedResponse = [firstAccept, secondAccept].find((response) => response.status === 200);
        const rejectedResponse = [firstAccept, secondAccept].find((response) => response.status === 400);
        assert.ok(acceptedResponse, "Exactly one staff member must be able to accept an order.");
        assert.ok(rejectedResponse, "The second staff acceptance attempt must be rejected.");

        const acceptedByUsername = acceptedResponse.data.order.acceptedByUsername;
        assert.ok(["tenant-a-staff-one", "tenant-a-staff-two"].includes(acceptedByUsername), "The accepted order should record its staff owner.");
        const ownerLogin = acceptedByUsername === "tenant-a-staff-one" ? staffOneLogin : staffTwoLogin;
        const otherLogin = acceptedByUsername === "tenant-a-staff-one" ? staffTwoLogin : staffOneLogin;

        const wrongDispatch = await request(port, `/api/staff/orders/status?restaurantId=${encodeURIComponent(restaurantA.id)}`, {
            method: "POST",
            body: JSON.stringify({ reference: orderReference, status: "Dispatched" })
        }, otherLogin.cookie);
        assert.equal(wrongDispatch.status, 400, "A staff member who did not accept an order must not dispatch it.");

        const ownerDispatch = await request(port, `/api/staff/orders/status?restaurantId=${encodeURIComponent(restaurantA.id)}`, {
            method: "POST",
            body: JSON.stringify({ reference: orderReference, status: "Dispatched" })
        }, ownerLogin.cookie);
        assert.equal(ownerDispatch.status, 200, "The staff member who accepted an order should be able to dispatch it.");
        assert.equal(ownerDispatch.data.order.status, "Dispatched", "Accepted orders should move directly to Dispatched.");

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
        assert.equal(tenantBPublicData.data.businessType, "home-vendor", "Vendor storefronts must receive their own display type.");
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
        assert.equal(publicRestaurants.data.platformSettings.platform_name, "PlateRoute", "New deployments should use the PlateRoute platform name.");
        const publicRestaurantA = publicRestaurants.data.restaurants.find((restaurant) => restaurant.id === restaurantA.id);
        const publicRestaurantB = publicRestaurants.data.restaurants.find((restaurant) => restaurant.id === restaurantB.id);
        assert.equal(publicRestaurantA.openingTime, "10:30", "Restaurant Admin opening time should update its public listing.");
        assert.equal(publicRestaurantA.closingTime, "23:00", "Restaurant Admin closing time should update its public listing.");
        assert.equal(publicRestaurantA.logoPath, "images/tenant-a-logo.png", "Restaurant Admin logo should update its public listing.");
        assert.equal(publicRestaurantB.businessType, "home-vendor", "Public directory should retain the business type.");
        assert.equal(publicRestaurantA.country, "Nigeria", "Public restaurants should retain their country for location-aware browsing.");
        assert.equal(publicRestaurantA.localGovernment, "Kaduna North", "Public restaurants should retain their Local Government Area.");
        assert.equal(typeof publicRestaurantA.latitude, "number", "Public restaurants should expose their nearby-sort coordinate without exposing owner data.");
        assert.equal(Object.hasOwn(publicRestaurantA, "ownerPhone"), false, "Public restaurant listings must not expose owner contact details.");

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
