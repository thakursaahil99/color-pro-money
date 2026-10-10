"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Spinner, StatusPill } from "@/components/ui";
import { api, fmtTime } from "@/lib/api";

interface Row {
  id: number;
  username: string;
  status: string;
  events: number;
  failed_logins: number;
  replays: number;
  duplicate_bets: number;
  late_bets: number;
  rate_limited: number;
  distinct_ips: number;
  last_event_at: string;
}

interface Anon {
  ip: string | null;
  type: string;
  events: number;
  last_event_at: string;
}

export default function AdminSecurity() {
  const [data, setData] = useState<{ users: Row[]; anonymous: Anon[] } | null>(null);
  useEffect(() => {
    api<{ users: Row[]; anonymous: Anon[] }>("/api/admin/suspicious").then(setData);
  }, []);
  if (!data) return <Spinner />;

  return (
    <div className="space-y-4">
      <section className="card">
        <h2 className="font-semibold">Suspicious activity · last 24 hours</h2>
        <p className="muted mb-3 text-sm">
          Accounts with failed logins, replayed or duplicate bet requests, late bets or rate-limit hits. Open a user to review and, if needed, suspend
          with a recorded reason.
        </p>
        {data.users.length === 0 ? (
          <p className="muted py-4 text-center text-sm">Nothing suspicious in the last 24 hours.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th className="text-right">Signals</th>
                  <th className="text-right">Failed logins</th>
                  <th className="text-right">Replays</th>
                  <th className="text-right">Duplicates</th>
                  <th className="text-right">Late bets</th>
                  <th className="text-right">Throttled</th>
                  <th className="text-right">IPs</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/admin/users/${r.id}`} className="text-sky-300 hover:underline">
                        #{r.id} {r.username}
                      </Link>
                    </td>
                    <td>
                      <StatusPill status={r.status} />
                    </td>
                    <td className="text-right font-bold tabular-nums">{r.events}</td>
                    <td className="text-right tabular-nums">{r.failed_logins}</td>
                    <td className="text-right tabular-nums">{r.replays}</td>
                    <td className="text-right tabular-nums">{r.duplicate_bets}</td>
                    <td className="text-right tabular-nums">{r.late_bets}</td>
                    <td className="text-right tabular-nums">{r.rate_limited}</td>
                    <td className="text-right tabular-nums">{r.distinct_ips}</td>
                    <td className="muted text-xs">{fmtTime(r.last_event_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="mb-2 font-semibold">Anonymous signals (no account)</h2>
        {data.anonymous.length === 0 ? (
          <p className="muted text-sm">None.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.anonymous.map((a, i) => (
              <li key={i} className="flex justify-between border-b border-navy-700/60 pb-1">
                <span>
                  {a.ip ?? "unknown"} · <span className="text-amber-200">{a.type.replace(/_/g, " ")}</span> × {a.events}
                </span>
                <span className="muted text-xs">{fmtTime(a.last_event_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
