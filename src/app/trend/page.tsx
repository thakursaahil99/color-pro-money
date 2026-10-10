"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GAMES, GAME_LABELS, NUMBERS, type Game } from "@shared/game";
import { RequireAuth, Spinner, numberBackground } from "@/components/ui";
import { api, qs } from "@/lib/api";
import { useGame } from "@/lib/useGame";

interface Row {
  code: string;
  number: number;
  price: number;
}

function Trend() {
  const g = useGame();
  const [game, setGame] = useState<Game>("parity");
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    api<{ results: Row[] }>(`/api/game/results${qs({ game, page: 1, pageSize: 50 })}`)
      .then((r) => setRows(r.results))
      .catch(() => setRows([]));
  }, [game, g.settleCount]);

  const counts = NUMBERS.map((n) => (rows ?? []).filter((r) => r.number === n).length);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Link href="/play" className="text-sm font-semibold text-[#16a394]">
          ‹ Back
        </Link>
        <h1 className="text-lg font-bold text-slate-800">Trend</h1>
        <span className="w-10" />
      </div>

      <div className="flex rounded-md bg-white shadow-sm" role="tablist" aria-label="Games">
        {GAMES.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={game === id}
            onClick={() => setGame(id)}
            className={`flex-1 border-b-2 py-2.5 text-sm font-semibold ${game === id ? "border-[#16a394] text-[#16a394]" : "border-transparent text-slate-500"}`}
          >
            {GAME_LABELS[id]}
          </button>
        ))}
      </div>

      <section className="rounded-md bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Last 50 periods · how often each number came</h2>
        <div className="grid grid-cols-10 gap-1 text-center">
          {NUMBERS.map((n) => (
            <div key={n}>
              <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: numberBackground(n) }}>
                {n}
              </div>
              <div className="mt-1 text-xs font-semibold tabular-nums text-slate-700">{counts[n]}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md bg-white p-3 shadow-sm">
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No results yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[340px] text-center text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-1.5 pr-1 text-left font-semibold">Period</th>
                  {NUMBERS.map((n) => (
                    <th key={n} className="w-6 font-semibold">
                      {n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code} className="border-t border-slate-100">
                    <td className="py-1 pr-1 text-left font-mono text-[10px] text-slate-600">{r.code}</td>
                    {NUMBERS.map((n) => (
                      <td key={n} className="py-1">
                        {r.number === n ? (
                          <span
                            className="mx-auto flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
                            style={{ background: numberBackground(n) }}
                          >
                            {n}
                          </span>
                        ) : (
                          <span className="text-slate-300">{n}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function TrendPage() {
  return (
    <RequireAuth>
      <Trend />
    </RequireAuth>
  );
}
