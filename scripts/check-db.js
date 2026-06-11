const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const databasePath = path.join(__dirname, "..", "data", "restaurant.db");
const db = new sqlite3.Database(databasePath);

db.get("PRAGMA integrity_check", [], (error, row) => {
    if (error) {
        console.error(`Database integrity check failed: ${error.message}`);
        db.close(() => process.exit(1));
        return;
    }

    const message = String(row && (row.integrity_check || Object.values(row)[0]) || "").trim() || "unknown";

    if (message.toLowerCase() !== "ok") {
        console.error(`Database integrity check failed: ${message}`);
        db.close(() => process.exit(1));
        return;
    }

    console.log("Database integrity check passed.");
    db.close(() => process.exit(0));
});
