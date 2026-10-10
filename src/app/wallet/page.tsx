"use client";

import { useEffect, useState } from "react";
import { PageTitle, Pagination, RequireAuth, Spinner, VirtualNotice } from "@/components/ui";
import { api, fmt, fmtTime, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Txn {
  id: number;
  type: string;
  amount: number;
  balance_after: number;
  description: string | null;
  created_at: string;
  round_code: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  signup_bonus: "Welcome bonus",
  bet_debit: "Bet placed",
  bet_payout: "Winnings",
  bet_refund: "Refund",
  referral_bonus: "Referral bonus",
  recharge_approved: "Recharge approved",
  daily_recharge: "Daily recharge",
};

function Wallet() {
  const { balance } = useAuth();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ transactions: Txn[]; total: number; pageSize: number } | null>(null);
  useEffect(() => {
    api<{ transactions: Txn[]; total: number; pageSize: number }>(`/api/me/transactions${qs({ page })}`).then(setData);
  }, [page]);

  return (
    <>
      <PageTitle title="Virtual wallet" subtitle="A complete ledger of your virtual points." />
      <div className="mb-4 grid gap-4 sm:grid-cols-[280px_1fr]">
        <div className="card">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Virtual points balance</div>
          <div className="mt-1 text-4xl font-extrabold tabular-nums text-sky-200">{fmt(balance)} VP</div>
        </div>
        <div className="flex items-center">
          <VirtualNotice />
        </div>
      </div>
      <div className="card">
        {!data ? (
          <Spinner />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Details</th>
                    <th className="text-right">Change</th>
                    <th className="text-right">Balance after</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="font-medium">{TYPE_LABEL[t.type] ?? t.type}</td>
                      <td className="muted text-xs">{t.description}</td>
                      <td className={`text-right font-semibold tabular-nums ${t.amount > 0 ? "text-green-300" : "text-red-300"}`}>
                        {t.amount > 0 ? "+" : ""}
                        {fmt(t.amount)} VP
                      </td>
                      <td className="text-right tabular-nums">{fmt(t.balance_after)} VP</td>
                      <td className="muted text-xs">{fmtTime(t.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}

export default function WalletPage() {
  return (
    <RequireAuth>
      <Wallet />
    </RequireAuth>
  );
}
