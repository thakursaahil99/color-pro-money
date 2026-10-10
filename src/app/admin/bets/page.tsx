"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GAMES, GAME_LABELS, SELECTIONS, type Game, type Selection } from "@shared/game";
import { Pagination, ResultDots, SelectionBadge, Spinner, StatusPill, selectionLabel } from "@/components/ui";
import { api, fmt, fmtTime, qs } from "@/lib/api";

interface Bet {
  id: number;
  user_id: number;
  username: string;
  round_code: string;
  game: Game;
  selection: Selection;
  amount: number;
  status: string;
  payout: number;
  created_at: string;
  result_number: number | null;
}

export default function AdminBets() {
  const [filters, setFilters] = useState({ userId: "", roundCode: "", game: "", selection: "", status: "" });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ bets: Bet[]; total: number; pageSize: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Allow deep links such as /admin/bets?roundCode=20261010-0001 or ?userId=5
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const init = { userId: sp.get("userId") ?? "", roundCode: sp.get("roundCode") ?? "", game: sp.get("game") ?? "", selection: "", status: "" };
    if (init.userId || init.roundCode) {
      setFilters(init);
      setApplied(init);
    }
  }, []);

  useEffect(() => {
    setError(null);
    api<{ bets: Bet[]; total: number; pageSize: number }>(`/api/admin/bets${qs({ ...applied, page })}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [applied, page]);

  return (
    <div className="space-y-4">
      <form
        className="card grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied(filters);
        }}
      >
        <input className="input" placeholder="User ID" inputMode="numeric" value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value })} />
        <input className="input" placeholder="Round ID" value={filters.roundCode} onChange={(e) => setFilters({ ...filters, roundCode: e.target.value })} />
        <select className="input" value={filters.game} onChange={(e) => setFilters({ ...filters, game: e.target.value })} aria-label="Game">
          <option value="">All games</option>
          {GAMES.map((g) => (
            <option key={g} value={g}>
              {GAME_LABELS[g]}
            </option>
          ))}
        </select>
        <select className="input" value={filters.selection} onChange={(e) => setFilters({ ...filters, selection: e.target.value })} aria-label="Selection">
          <option value="">Any selection</option>
          {SELECTIONS.map((s) => (
            <option key={s} value={s}>
              {selectionLabel(s)}
            </option>
          ))}
        </select>
        <select className="input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="Status">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>
        <button className="btn-primary">Filter</button>
      </form>

      <div className="card">
        {error && <p className="text-sm text-red-300">{error}</p>}
        {!data ? (
          <Spinner />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Bet</th>
                    <th>User</th>
                    <th>Game</th>
                    <th>Period</th>
                    <th>Selection</th>
                    <th className="text-right">Wagered</th>
                    <th>Placed</th>
                    <th>Status</th>
                    <th>Result</th>
                    <th className="text-right">Awarded</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bets.map((b) => (
                    <tr key={b.id}>
                      <td className="font-mono text-xs text-slate-400">#{b.id}</td>
                      <td>
                        <Link href={`/admin/users/${b.user_id}`} className="text-sky-300 hover:underline">
                          #{b.user_id}
                        </Link>{" "}
                        <span className="muted text-xs">{b.username}</span>
                      </td>
                      <td>{GAME_LABELS[b.game]}</td>
                      <td className="font-mono text-xs">{b.round_code}</td>
                      <td>
                        <span className="inline-flex items-center gap-2">
                          <SelectionBadge selection={b.selection} size="sm" />
                          {selectionLabel(b.selection)}
                        </span>
                      </td>
                      <td className="text-right tabular-nums">{fmt(b.amount)}</td>
                      <td className="muted whitespace-nowrap text-xs">{fmtTime(b.created_at)}</td>
                      <td>
                        <StatusPill status={b.status} />
                      </td>
                      <td>
                        {b.result_number !== null ? (
                          <span className="inline-flex items-center gap-2">
                            <strong>{b.result_number}</strong> <ResultDots number={b.result_number} />
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className={`text-right tabular-nums ${b.payout ? "text-green-300" : "text-slate-500"}`}>{fmt(b.payout)}</td>
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
