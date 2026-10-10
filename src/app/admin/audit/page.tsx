"use client";

import { useEffect, useState } from "react";
import { Pagination, Spinner } from "@/components/ui";
import { api, fmtTime, qs } from "@/lib/api";

interface Log {
  id: number;
  actor: string;
  admin_user_id: number | null;
  admin_username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  entry_hash: string;
  created_at: string;
}

interface Verify {
  entries: number;
  broken: number;
  first_broken_id: number | null;
  valid: boolean;
}

export default function AdminAudit() {
  const [actor, setActor] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ logs: Log[]; total: number; pageSize: number } | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api<{ logs: Log[]; total: number; pageSize: number }>(`/api/admin/audit${qs({ actor, page })}`).then(setData);
  }, [actor, page]);

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Immutable audit log</h2>
          <p className="muted text-sm">Append-only and SHA-256 hash-chained. Entries cannot be edited or deleted, even directly in the database.</p>
        </div>
        <div className="flex items-center gap-3">
          {verify && (
            <span className={`text-sm font-semibold ${verify.valid ? "text-green-300" : "text-red-300"}`}>
              {verify.valid ? `✓ Chain intact (${verify.entries} entries)` : `✗ ${verify.broken} broken, first at #${verify.first_broken_id}`}
            </span>
          )}
          <button
            className="btn-ghost text-sm"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              setVerify(await api<Verify>("/api/admin/audit/verify"));
              setChecking(false);
            }}
          >
            {checking ? "Verifying…" : "Verify chain"}
          </button>
        </div>
      </section>

      <div className="card">
        <div className="mb-3 flex justify-end">
          <select
            className="input w-auto"
            aria-label="Filter by actor"
            value={actor}
            onChange={(e) => {
              setPage(1);
              setActor(e.target.value);
            }}
          >
            <option value="">All actors</option>
            <option value="admin">Admin actions</option>
            <option value="system">System (game engine)</option>
            <option value="cli">Setup scripts</option>
          </select>
        </div>
        {!data ? (
          <Spinner />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Time</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Details</th>
                    <th>Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {data.logs.map((l) => (
                    <tr key={l.id}>
                      <td className="font-mono text-xs text-slate-400">{l.id}</td>
                      <td className="muted whitespace-nowrap text-xs">{fmtTime(l.created_at)}</td>
                      <td className="text-xs">
                        {l.actor === "admin" ? (
                          <span className="text-amber-200">
                            {l.admin_username} (#{l.admin_user_id})
                          </span>
                        ) : (
                          <span className="text-slate-300">{l.actor}</span>
                        )}
                        {l.ip && <div className="text-[10px] text-slate-500">{l.ip}</div>}
                      </td>
                      <td className="font-medium">{l.action.replace(/_/g, " ")}</td>
                      <td className="text-xs">
                        {l.target_type}
                        {l.target_id && <span className="font-mono"> {l.target_id}</span>}
                      </td>
                      <td className="max-w-[280px] truncate font-mono text-[11px] text-slate-400" title={JSON.stringify(l.details)}>
                        {JSON.stringify(l.details)}
                      </td>
                      <td className="font-mono text-[10px] text-slate-500" title={l.entry_hash}>
                        {l.entry_hash.slice(0, 10)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
