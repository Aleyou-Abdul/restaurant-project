const crypto = require("crypto");

// Generate a stable 32-byte key for encrypting restaurant payment credentials at rest.
console.log(crypto.randomBytes(32).toString("hex"));
