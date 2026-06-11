const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const rootDir = path.join(__dirname, "..");
const databasePath = path.join(rootDir, "data", "restaurant.db");
const backupsDir = path.join(rootDir, "data", "backups");

if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
}

const fileName = `manual-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
const backupPath = path.join(backupsDir, fileName).replace(/'/g, "''");
const db = new sqlite3.Database(databasePath);

db.exec(`VACUUM INTO '${backupPath}'`, (error) => {
    if (error) {
        console.error(`Database backup failed: ${error.message}`);
        db.close(() => process.exit(1));
        return;
    }

    console.log(`Database backup created: data/backups/${fileName}`);
    db.close(() => process.exit(0));
});
