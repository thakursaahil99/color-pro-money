import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: { STARTING_POINTS: "1000", REFERRAL_BONUS_POINTS: "150" }, // fixed so tests do not depend on .env
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
