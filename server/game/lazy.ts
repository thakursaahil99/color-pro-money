import { GameEngine } from "./engine";

/**
 * Serverless mode (Vercel): there is no long-running process, so instead of a 1-second timer
 * the engine is advanced by incoming requests. A pass opens, closes and settles rounds, and
 * catches up on anything missed while nobody was visiting. It is idempotent and protected by
 * row locks, so several function instances running it at once cannot settle a round twice.
 */
export class LazyEngine {
  private engine = new GameEngine();
  private lastRun = 0;

  constructor(private minIntervalMs = 1000) {}

  async ensureFresh(): Promise<void> {
    const t = Date.now();
    if (t - this.lastRun < this.minIntervalMs) return;
    this.lastRun = t;
    await this.engine.tick();
  }
}
