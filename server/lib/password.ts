import crypto from "node:crypto";

// scrypt is a memory-hard password hashing function built into Node (no native addon needed).
const N = 1 << 15;
const r = 8;
const p = 1;
const KEYLEN = 64;
const MAXMEM = 128 * N * r * 2;

function scrypt(password: string, salt: Buffer, n: number, rr: number, pp: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: n, r: rr, p: pp, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, N, r, p);
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, rr, pp, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), Number(n), Number(rr), Number(pp));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Used to keep login timing similar whether or not the account exists. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString("hex"));
  return dummyHash;
}
