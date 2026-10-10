"use client";

import { useEffect, useState } from "react";
import { GAMES, GAME_LABELS, type Game, type Selection } from "@shared/game";
import { Pagination, RequireAuth, ResultDots, SelectionBadge, Spinner, StatusPill, selectionLabel } from "@/components/ui";
import { api, fmt, fmtTime, qs } from "@/lib/api";

interface Bet {
  id: number;
  game: Game;
  round_code: string;
  selection: Selection;
  amount: number;
  status: string;
  payout: number;
  created_at: string;
  result_number: number | null;
}

function History() {
  const [game, setGame] = useState<Game | "">("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ bets: Bet[]; total: number; pageSize: number } | null>(null);

  useEffect(() => {
    setData(null);
    api<{ bets: Bet[]; total: number; pageSize: number }>(`/api/me/bets${qs({ page, game })}`).then(setData);
  }, [page, game]);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold text-slate-800">My bets</h1>
        <p className="muted text-sm">Every bet you placed and how its period finished. All amounts are virtual points (VP).</p>
      </div>

      <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter by game">
        {(["", ...GAMES] as const).map((id) => (
          <button
            key={id || "all"}
            role="tab"
            aria-selected={game === id}
            onClick={() => {
              setGame(id);
              setPage(1);
            }}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${game === id ? "bg-[#16a394] text-white" : "bg-white text-slate-600 shadow-sm"}`}
          >
            {id ? GAME_LABELS[id] : "All"}
          </button>
        ))}
      </div>

      <div className="card">
        {!data ? (
          <Spinner />
        ) : data.bets.length === 0 ? (
          <p className="muted py-6 text-center">No bets yet. Head to Home to place your first one.</p>
        ) : (
          <>
            <ul className="divide-y divide-navy-700">
              {data.bets.map((b) => (
                <li key={b.id} className="flex items-center gap-3 py-3">
                  <SelectionBadge selection={b.selection} />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-semibold">
                      {fmt(b.amount)} VP on {selectionLabel(b.selection)}
                    </div>
                    <div className="muted truncate text-xs">
                      {GAME_LABELS[b.game]} · <span className="font-mono">{b.round_code}</span>
                    </div>
                    <div className="muted flex items-center gap-1.5 text-xs">
                      {fmtTime(b.created_at)}
                      {b.result_number !== null && (
                        <>
                          · result <strong className="text-slate-700">{b.result_number}</strong> <ResultDots number={b.result_number} />
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <StatusPill status={b.status} />
                    {b.status === "won" && <div className="mt-1 text-xs font-semibold text-green-300">+{fmt(b.payout)} VP</div>}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <RequireAuth>
      <History />
    </RequireAuth>
  );
}
