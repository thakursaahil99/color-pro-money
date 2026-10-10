"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pagination, Spinner, Stat } from "@/components/ui";
import { api, fmt, fmtTime, qs } from "@/lib/api";

interface Row {
  id: number;
  bonus: number;
  created_at: string;
  referrer_id: number;
  referrer_username: string;
  referred_id: number;
  referred_username: string;
  referred_mobile: string | null;
}

export default function AdminReferrals() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ referrals: Row[]; total: number; totalBonus: number; pageSize: number } | null>(null);

  useEffect(() => {
    api<{ referrals: Row[]; total: number; totalBonus: number; pageSize: number }>(`/api/admin/referrals${qs({ page })}`).then(setData);
  }, [page]);

  if (!data) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Referrals" value={fmt(data.total)} hint="Friends who joined with a code" />
        <Stat label="Bonus paid" value={`${fmt(data.totalBonus)} VP`} hint="Virtual points" />
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Referrer</th>
                <th>New player</th>
                <th>Mobile</th>
                <th className="text-right">Bonus (VP)</th>
              </tr>
            </thead>
            <tbody>
              {data.referrals.map((r) => (
                <tr key={r.id}>
                  <td className="muted whitespace-nowrap text-xs">{fmtTime(r.created_at)}</td>
                  <td>
                    <Link href={`/admin/users/${r.referrer_id}`} className="text-sky-300 hover:underline">
                      #{r.referrer_id} {r.referrer_username}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/admin/users/${r.referred_id}`} className="text-sky-300 hover:underline">
                      #{r.referred_id} {r.referred_username}
                    </Link>
                  </td>
                  <td className="font-mono text-xs">{r.referred_mobile ?? "—"}</td>
                  <td className="text-right tabular-nums">{fmt(r.bonus)}</td>
                </tr>
              ))}
              {data.referrals.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted py-6 text-center">
                    No referrals yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
      </div>
    </div>
  );
}
