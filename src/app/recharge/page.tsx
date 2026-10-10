"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RECHARGE_AMOUNTS } from "@shared/recharge";
import { ErrorText, RequireAuth, Spinner, StatusPill } from "@/components/ui";
import { ApiError, api, fmt, fmtTime } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Request {
  id: number;
  amount: number;
  status: "pending" | "approved" | "rejected";
  reject_reason: string | null;
  created_at: string;
  decided_at: string | null;
}

interface Data {
  amounts: number[];
  pending: Request | null;
  history: Request[];
}

function Recharge() {
  const { balance, refresh } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api<Data>("/api/me/recharge");
    setData((prev) => {
      // A request that was waiting and is now decided: refresh the balance and tell the player.
      if (prev?.pending && !d.pending) {
        const decided = d.history.find((h) => h.id === prev.pending!.id);
        if (decided?.status === "approved") setMessage(`Approved! ${fmt(decided.amount)} VP were added to your balance.`);
        if (decided?.status === "rejected") setMessage(`Your ${fmt(decided.amount)} VP request was rejected${decided.reject_reason ? `: ${decided.reject_reason}` : "."}`);
        void refresh();
      }
      return d;
    });
  }, [refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  // While a request is waiting, check every few seconds so the player sees the decision.
  useEffect(() => {
    if (!data?.pending) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [data?.pending, load]);

  async function request(amount: number) {
    setBusy(amount);
    setError(null);
    setMessage(null);
    try {
      await api("/api/me/recharge", { body: { amount } });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong, please try again");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Link href="/play" className="text-sm font-semibold text-[#16a394]">
          ‹ Back
        </Link>
        <h1 className="text-lg font-bold text-slate-800">Recharge</h1>
        <span className="w-10" />
      </div>

      <section className="rounded-md bg-white p-4 text-center shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current balance</div>
        <div className="mt-1 text-3xl font-extrabold tabular-nums text-slate-800">{fmt(balance)} VP</div>
      </section>

      {message && (
        <p role="status" className="rounded-md border border-[#a7ddd6] bg-[#e6f6f4] px-3 py-2 text-sm font-medium text-[#0b7a70]">
          {message}
        </p>
      )}
      <ErrorText error={error} />

      <section className="rounded-md bg-white p-4 shadow-sm">
        {!data ? (
          <Spinner />
        ) : data.pending ? (
          <div className="text-center">
            <h2 className="font-bold text-slate-800">Waiting for admin approval</h2>
            <p className="mt-1 text-sm text-slate-500">
              Your request for <strong className="text-[#16a394]">{fmt(data.pending.amount)} VP</strong> was sent. The points are added to your balance as soon as an admin approves it.
            </p>
            <div className="mx-auto mt-3 h-1.5 w-32 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-[#16a394]" />
            </div>
          </div>
        ) : (
          <>
            <h2 className="text-center font-bold text-slate-800">Ask for points</h2>
            <p className="mt-1 text-center text-sm text-slate-500">Choose an amount. An admin approves it, then it appears in your balance. It&apos;s free.</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {RECHARGE_AMOUNTS.map((a) => (
                <button
                  key={a}
                  disabled={busy !== null}
                  onClick={() => request(a)}
                  className="rounded-md bg-[#16a394] py-4 text-lg font-extrabold tabular-nums text-white shadow-sm active:scale-95 disabled:opacity-50"
                >
                  {busy === a ? "Sending…" : `${fmt(a)} VP`}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {data && data.history.length > 0 && (
        <section className="rounded-md bg-white p-3 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Your requests</h2>
          <ul className="divide-y divide-slate-100">
            {data.history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <div className="font-semibold tabular-nums text-slate-800">{fmt(h.amount)} VP</div>
                  <div className="text-xs text-slate-500">
                    {fmtTime(h.created_at)}
                    {h.reject_reason && <span> · {h.reject_reason}</span>}
                  </div>
                </div>
                <StatusPill status={h.status === "approved" ? "won" : h.status === "rejected" ? "lost" : "pending"} label={h.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-center text-xs text-slate-500">Virtual points have no cash value and cannot be bought, sold or withdrawn.</p>
    </div>
  );
}

export default function RechargePage() {
  return (
    <RequireAuth>
      <Recharge />
    </RequireAuth>
  );
}
