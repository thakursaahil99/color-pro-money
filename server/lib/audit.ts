import type { Db } from "../db/pool";

export interface AuditEntry {
  actor: "admin" | "system" | "cli";
  adminUserId?: number | null;
  action: string;
  targetType?: string;
  targetId?: string | number;
  details?: Record<string, unknown>;
  ip?: string | null;
}

/** Appends to the append-only, hash-chained admin_audit_logs table. */
export async function audit(db: Db, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_logs (actor, admin_user_id, action, target_type, target_id, details, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      e.actor,
      e.adminUserId ?? null,
      e.action,
      e.targetType ?? null,
      e.targetId != null ? String(e.targetId) : null,
      JSON.stringify(e.details ?? {}),
      e.ip ?? null,
    ],
  );
}
