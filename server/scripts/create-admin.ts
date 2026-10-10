/**
 * Secure admin setup.
 *
 *   npm run admin:create -- --username admin --email admin@example.com
 *
 * The password is read from the ADMIN_PASSWORD env var if set (min 8 chars, letters + numbers; 12+ is recommended);
 * otherwise a strong random password is generated and printed ONCE. Only a scrypt hash is stored.
 * Admin accounts can only be created from the server's command line, never through the website.
 */
import crypto from "node:crypto";
import { config } from "../config";
import { pool, withTransaction } from "../db/pool";
import { migrate } from "../db/migrate";
import { audit } from "../lib/audit";
import { hashPassword } from "../lib/password";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const username = arg("username") ?? process.env.ADMIN_USERNAME ?? "admin";
  const email = (arg("email") ?? process.env.ADMIN_EMAIL ?? "admin@colorpromoney.local").toLowerCase();
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(18).toString("base64url") + "9a";
    generated = true;
  }
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters and contain letters and numbers");
  }
  if (!generated && password.length < 12) {
    console.warn("Warning: this admin password is short. Use 12+ characters before putting the site online.");
  }
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) throw new Error("username must be 3-24 letters, numbers or underscores");

  await migrate(false);
  const hash = await hashPassword(password);
  const id = await withTransaction(async (db) => {
    const existing = await db.query("SELECT id FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($2)", [username, email]);
    if (existing.rows.length) throw new Error("A user with that username or email already exists");
    const { rows } = await db.query(
      "INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id",
      [username, email, hash],
    );
    const uid = rows[0].id as number;
    await db.query("INSERT INTO virtual_wallets (user_id, balance) VALUES ($1, 0)", [uid]);
    await audit(db, { actor: "cli", action: "admin_created", targetType: "user", targetId: uid, details: { username, email } });
    return uid;
  });

  console.log(`\nAdmin account created (id ${id}) in ${config.env} database.`);
  console.log(`  username: ${username}`);
  if (generated) {
    console.log(`  password: ${password}`);
    console.log("  -> This password is shown only once. Store it in a password manager.\n");
  } else {
    console.log("  password: (from ADMIN_PASSWORD)\n");
  }
}

main()
  .catch((e) => {
    console.error(`Error: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
