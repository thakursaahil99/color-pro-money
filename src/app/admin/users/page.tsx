"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pagination, Spinner, StatusPill } from "@/components/ui";
import { api, fmt, fmtTime, qs } from "@/lib/api";

interface UserRow {
  id: number;
  username: string;
  mobile: string | null;
  role: string;
  status: string;
  created_at: string;
  last_seen_at: string | null;
  is_demo: boolean;
  balance: number | null;
  bet_count: number;
}

export default function AdminUsers() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [applied, setApplied] = useState({ q: "", status: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ users: UserRow[]; total: number; pageSize: number } | null>(null);

  useEffect(() => {
    api<{ users: UserRow[]; total: number; pageSize: number }>(`/api/admin/users${qs({ ...applied, page })}`).then(setData);
  }, [applied, page]);

  return (
    <div className="space-y-4">
      <form
        className="card flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied({ q, status });
        }}
      >
        <input className="input flex-1" placeholder="Search by user ID, mobile number or nickname" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <button className="btn-primary">Search</button>
      </form>

      <div className="card">
        {!data ? (
          <Spinner />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nickname</th>
                    <th>Mobile</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th className="text-right">Balance (VP)</th>
                    <th className="text-right">Bets</th>
                    <th>Last seen</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <Link href={`/admin/users/${u.id}`} className="font-mono text-sky-300 hover:underline">
                          #{u.id}
                        </Link>
                      </td>
                      <td>
                        <Link href={`/admin/users/${u.id}`} className="hover:underline">
                          {u.username}
                        </Link>
                        {u.is_demo && <span className="ml-2 rounded bg-slate-600/40 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">demo</span>}
                      </td>
                      <td className="font-mono text-xs">{u.mobile ?? "—"}</td>
                      <td className={u.role === "admin" ? "text-amber-200" : ""}>{u.role}</td>
                      <td>
                        <StatusPill status={u.status} />
                      </td>
                      <td className="text-right tabular-nums">{fmt(u.balance)}</td>
                      <td className="text-right tabular-nums">{fmt(u.bet_count)}</td>
                      <td className="muted text-xs">{fmtTime(u.last_seen_at)}</td>
                      <td className="muted text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
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
