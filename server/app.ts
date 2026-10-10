import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { config } from "./config";
import { LazyEngine } from "./game/lazy";
import { csrfGuard, loadSession } from "./lib/auth";
import { ah, errorHandler } from "./lib/errors";
import { createAdminRouter } from "./routes/admin";
import { createAuthRouter } from "./routes/auth";
import { createGameRouter } from "./routes/game";
import { createMeRouter } from "./routes/me";

export interface AppOptions {
  /** Advance the game engine from incoming requests (serverless). Defaults to config.lazyEngine. */
  lazyEngine?: boolean;
  /** Minimum time between engine passes in lazy mode (default 1000 ms). */
  lazyMinIntervalMs?: number;
}

/** Builds the API app. The Next.js UI is mounted after it in server/index.ts (or served by Vercel). */
export function createApp(options: AppOptions = {}) {
  const lazy = (options.lazyEngine ?? config.lazyEngine) ? new LazyEngine(options.lazyMinIntervalMs) : null;

  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

  // Next.js injects inline scripts, so CSP is left to a reverse proxy / next.config if desired.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  const api = express.Router();
  // On Vercel the platform may already have parsed a JSON body; tell body-parser not to wait for the stream again.
  api.use((req, _res, next) => {
    if (config.isServerless && req.body && typeof req.body === "object") (req as unknown as { _body: boolean })._body = true;
    next();
  });
  api.use(express.json({ limit: "10kb" }));
  api.use(cookieParser());
  api.use(csrfGuard);
  if (lazy) {
    api.use(
      ah(async (req, _res, next) => {
        if (req.path !== "/health") await lazy.ensureFresh();
        next();
      }),
    );
  }
  api.use(loadSession);
  api.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  api.get("/health", (_req, res) => res.json({ ok: true, env: config.env }));
  api.use("/auth", createAuthRouter());
  api.use("/me", createMeRouter());
  api.use("/game", createGameRouter());
  api.use("/admin", createAdminRouter());
  api.use((_req, res) => res.status(404).json({ error: { code: "not_found", message: "Unknown API route" } }));
  api.use(errorHandler);

  app.use("/api", api);
  return app;
}
