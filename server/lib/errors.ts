import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const badRequest = (code: string, msg: string) => new HttpError(400, code, msg);
export const unauthorized = (msg = "Please log in") => new HttpError(401, "unauthorized", msg);
export const forbidden = (msg = "Forbidden") => new HttpError(403, "forbidden", msg);
export const notFound = (msg = "Not found") => new HttpError(404, "not_found", msg);
export const conflict = (code: string, msg: string) => new HttpError(409, code, msg);

/** Wraps an async route so rejected promises reach the error handler. */
export function ah<T extends Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: T, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "validation_error", message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") },
    });
    return;
  }
  if (err && typeof err === "object" && (err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "bad_json", message: "Malformed JSON body" } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal", message: "Something went wrong" } });
}
