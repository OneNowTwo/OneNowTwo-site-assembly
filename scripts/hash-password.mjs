#!/usr/bin/env node
// Usage: npm run auth:hash -- 'your-password'
// Prints a bcrypt hash for AUTH_PASSWORD_HASH. In .env files escape each "$" as "\$" (Next.js expands $VARS);
// in the Render dashboard paste the hash as-is.
import bcrypt from "bcryptjs";

const pw = process.argv[2];
if (!pw || pw.length < 8) {
  console.error("Provide a password of at least 8 characters: npm run auth:hash -- 'your-password'");
  process.exit(1);
}
const hash = bcrypt.hashSync(pw, 12);
console.log(`Render / dashboard value:\n  ${hash}\n\n.env line:\n  AUTH_PASSWORD_HASH="${hash.replace(/\$/g, "\\$")}"`);
