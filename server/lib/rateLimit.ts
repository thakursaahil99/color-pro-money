import type { NextFunction, Request, Response } from "express";
import { recordSecurityEvent } from "./security";

interface Bucket { count: number; resetAt: number }

/**
 * Fixed-window, in-memory rate limiter. Good for a single instance; for several
 * instances behind a load balancer swap the Map for a shared store.
 */
export function rateLimit(opts: { name: string; windowMs: number; max: number; key?: (req: Request) => string }) {
  const buckets = new Map<string, Bucket>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, opts.windowMs);
  sweep.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = opts.key ? opts.key(req) : req.user ? `u:${req.user.id}` : `ip:${req.ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, b);
    }
    b.count++;
    res.setHeader("RateLimit-Limit", String(opts.max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, opts.max - b.count)));
    if (b.count > opts.max) {
      res.setHeader("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
      if (b.count === opts.max + 1) {
        recordSecurityEvent(req.user?.id ?? null, "rate_limited", { limiter: opts.name, path: req.path }, req.ip);
      }
      res.status(429).json({ error: { code: "rate_limited", message: "Too many requests, please slow down." } });
      return;
    }
    next();
  };
}
