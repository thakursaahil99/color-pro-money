/**
 * Vercel serverless entry: every /api/* request is handled by the same Express app that runs locally.
 * The game engine advances lazily inside requests (see server/game/lazy.ts) because Vercel has no
 * long-running process.
 */
import { createApp } from "../server/app";

const app = createApp();

export default app;
