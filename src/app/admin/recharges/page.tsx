"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorText, Modal, Pagination, Spinner, StatusPill } from "@/components/ui";
import { api, fmt, fmtTime, qs } from "@/lib/api";

interface Row {
  id: number;
  user_id: number;
  username: string;
  mobile: string | null;
  amount: number;
  status: "pending" | "approved" | "rejected";
  reject_reason: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by_username: string | null;
  balance: number | null;
}

interface Resp {
  requests: Row[];
  total: number;
  pending: number;
  pageSize: number;
}

const FILTERS = [
  { id: "pending", label: "Waiting" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "", label: "All" },
] as const;

export default function AdminRecharges() {
  const [status, setStatus] = useState<(typeof FILTERS)[number]["id"]>("pending");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<Row | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    api<Resp>(`/api/admin/recharges${qs({ status, page })}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [status, page]);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000); // new requests show up without a refresh
    return () => clearInterval(id);
  }, [load]);

  async function decide(row: Row, action: "approve" | "reject") {
    setBusyId(row.id);
    setError(null);
    try {
      await api(`/api/admin/recharges/${row.id}/${action}`, { body: action === "reject" ? { reason } : {} });
      setRejecting(null);
      setReason("");
      load();
    } catch (e) {
      setError((e as Error).message);
      setRejecting(null);
      load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Recharge requests</h2>
          <p className="muted text-sm">Players ask for free virtual points. Nothing is paid: approving credits the points, rejecting needs a reason. Each decision is audited.</p>
        </div>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              role="tab"
              aria-selected={status === f.id}
              onClick={() => {
                setStatus(f.id);
                setPage(1);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${status === f.id ? "bg-sky-500/20 text-sky-100" : "text-slate-400 hover:text-white"}`}
            >
              {f.label}
              {f.id === "pending" && data && data.pending > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-xs text-white">{data.pending}</span>}
            </button>
          ))}
        </div>
      </section>

      <ErrorText error={error} />

      <div className="card">
        {!data ? (
          <Spinner />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Requested</th>
                    <th>Player</th>
                    <th className="text-right">Points</th>
                    <th className="text-right">Balance now</th>
                    <th>Status</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.requests.map((r) => (
                    <tr key={r.id}>
                      <td className="muted whitespace-nowrap text-xs">{fmtTime(r.created_at)}</td>
                      <td>
                        <Link href={`/admin/users/${r.user_id}`} className="text-sky-300 hover:underline">
                          #{r.user_id} {r.username}
                        </Link>
                        {r.mobile && <div className="font-mono text-xs text-slate-500">{r.mobile}</div>}
                      </td>
                      <td className="text-right font-semibold tabular-nums">{fmt(r.amount)} VP</td>
                      <td className="text-right tabular-nums">{fmt(r.balance)}</td>
                      <td>
                        <StatusPill status={r.status === "approved" ? "won" : r.status === "rejected" ? "lost" : "pending"} label={r.status} />
                        {r.status !== "pending" && (
                          <div className="muted mt-1 text-xs">
                            by {r.decided_by_username} · {fmtTime(r.decided_at)}
                            {r.reject_reason && <div>“{r.reject_reason}”</div>}
                          </div>
                        )}
                      </td>
                      <td className="text-right">
                        {r.status === "pending" && (
                          <div className="inline-flex gap-2">
                            <button className="btn-primary px-3 py-1.5 text-sm" disabled={busyId === r.id} onClick={() => decide(r, "approve")}>
                              Approve
                            </button>
                            <button
                              className="btn-danger px-3 py-1.5 text-sm"
                              disabled={busyId === r.id}
                              onClick={() => {
                                setError(null);
                                setReason("");
                                setRejecting(r);
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.requests.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted py-8 text-center">
                        {status === "pending" ? "No requests are waiting." : "Nothing here yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
          </>
        )}
      </div>

      <Modal open={rejecting !== null} onClose={() => setRejecting(null)} title="Reject recharge request">
        {rejecting && (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              {rejecting.username} asked for <strong>{fmt(rejecting.amount)} VP</strong>. The player will see your reason.
            </p>
            <input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (min 3 characters)" />
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost" onClick={() => setRejecting(null)}>
                Cancel
              </button>
              <button className="btn-danger" disabled={reason.trim().length < 3 || busyId === rejecting.id} onClick={() => decide(rejecting, "reject")}>
                Reject
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
