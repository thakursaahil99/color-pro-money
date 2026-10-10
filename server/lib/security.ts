import { pool, type Db } from "../db/pool";

const pending = new Set<Promise<unknown>>();

/** Records a signal for the admin "suspicious activity" review. Never throws. */
export function recordSecurityEvent(
  userId: number | null,
  type: string,
  details: Record<string, unknown> = {},
  ip?: string | null,
  db: Db = pool,
): void {
  const p = db
    .query("INSERT INTO security_events (user_id, type, details, ip) VALUES ($1, $2, $3, $4)", [
      userId,
      type,
      JSON.stringify(details),
      ip ?? null,
    ])
    .catch((e) => console.error("security event failed", e))
    .finally(() => pending.delete(p));
  pending.add(p);
}

/** Waits for in-flight security event writes (used by tests and graceful shutdown). */
export async function flushSecurityEvents(): Promise<void> {
  await Promise.all([...pending]);
}
