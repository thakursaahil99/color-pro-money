import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const isTest = process.env.NODE_ENV === "test" || !!process.env.VITEST;
/** True when running as a serverless function on Vercel (no long-running process, no timers). */
const isServerless = !!process.env.VERCEL;

export const config = {
  env: process.env.NODE_ENV ?? "development",
  isProd: process.env.NODE_ENV === "production",
  isTest,
  port: Number(process.env.PORT ?? 3000),
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:3000",
  databaseUrl: isTest
    ? required("TEST_DATABASE_URL")
    : required("DATABASE_URL"),
  databaseSsl: process.env.DATABASE_SSL === "true",
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 168),
  demoMode: process.env.DEMO_MODE === "true",
  // New accounts start with this many virtual points (0 = start empty).
  startingPoints: Number(process.env.STARTING_POINTS ?? 0),
  // Virtual points the referrer receives for every friend who registers with their code.
  referralBonus: Number(process.env.REFERRAL_BONUS_POINTS ?? 150),
  isServerless,
  // Serverless: the game engine runs lazily inside API requests instead of on a timer.
  lazyEngine: isServerless || process.env.ENGINE_MODE === "lazy",
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? (isServerless ? 2 : 10)),
  sessionCookie: process.env.NODE_ENV === "production" ? "__Host-cpm_session" : "cpm_session",
};
