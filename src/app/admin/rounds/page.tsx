"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { GAMES, GAME_LABELS, type Game, type RoundTiming } from "@shared/game";
import { Pagination, ResultDots, Spinner, StatusPill } from "@/components/ui";
import { api, fmt, fmtTime, qs } from "@/lib/api";
import { useGame, useServerNow } from "@/lib/useGame";

interface Round {
  id: number;
  game: Game;
  code: string;
  status: string;
  starts_at: string;
  betting_closes_at: string;
  ends_at: string;
  settled_at: string | null;
  commit_hash: string;
  server_seed: string | null;
  result: number | null;
  result_price: number | null;
  result_at: string | null;
  bet_count: number;
  points_wagered: number;
  points_awarded: number;
}

interface Resp {
  rounds: Round[];
  total: number;
  pageSize: number;
  paused: boolean;
  upcoming: RoundTiming[];
}

export default function AdminRounds() {
  const live = useGame();
  const now = useServerNow(live.offset, 1000);
  const [status, setStatus] = useState("");
  const [gameF, setGameF] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Resp | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    const load = () => api<Resp>(`/api/admin/rounds${qs({ status, game: gameF, page })}`).then(setData);
    void load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [status, gameF, page, live.settleCount]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-2 font-semibold">Betting window monitor</h2>
          {live.rounds.parity ? (
            <>
              <p className="font-mono text-sm">{live.rounds.parity.code} · all games share this schedule</p>
              <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-navy-950">
                <div className="absolute inset-y-0 left-0 bg-green-500/70" style={{ width: `${(150 / 180) * 100}%` }} />
                <div className="absolute inset-y-0 right-0 bg-amber-500/60" style={{ width: `${(30 / 180) * 100}%` }} />
                <div
                  className="absolute inset-y-0 w-1 bg-white"
                  style={{ left: `${Math.min(100, Math.max(0, ((now - live.rounds.parity.startsAt) / 180_000) * 100))}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-xs text-slate-400">
                <span>Open {new Date(live.rounds.parity.startsAt).toLocaleTimeString()}</span>
                <span>Lock {new Date(live.rounds.parity.bettingClosesAt).toLocaleTimeString()}</span>
                <span>End {new Date(live.rounds.parity.endsAt).toLocaleTimeString()}</span>
              </div>
              <p className="mt-2 text-sm">
                {now < live.rounds.parity.bettingClosesAt ? (
                  <span className="text-green-300">Betting open</span>
                ) : (
                  <span className="text-amber-300">Betting closed, awaiting result</span>
                )}
              </p>
            </>
          ) : (
            <p className="muted text-sm">{data?.paused ? "Rounds are paused for maintenance." : "No active round right now."}</p>
          )}
        </section>
        <section className="card">
          <h2 className="mb-2 font-semibold">Upcoming rounds</h2>
          {data?.upcoming.length ? (
            <ul className="space-y-1 text-sm">
              {data.upcoming.map((u) => (
                <li key={u.code} className="flex justify-between">
                  <span className="font-mono">{u.code}</span>
                  <span className="muted">
                    {new Date(u.startsAt).toLocaleTimeString()} – {new Date(u.endsAt).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted text-sm">{data?.paused ? "Paused — no rounds scheduled." : "—"}</p>
          )}
        </section>
      </div>

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">All rounds</h2>
          <select className="input w-auto" value={gameF} aria-label="Filter by game" onChange={(e) => { setPage(1); setGameF(e.target.value); }}>
            <option value="">All games</option>
            {GAMES.map((g) => (
              <option key={g} value={g}>
                {GAME_LABELS[g]}
              </option>
            ))}
          </select>
          <select
            className="input w-auto"
            value={status}
            aria-label="Filter by status"
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">All</option>
            <option value="open">Active (betting)</option>
            <option value="closed">Active (locked)</option>
            <option value="settled">Completed</option>
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
                    <th>Game</th>
                    <th>Period</th>
                    <th>Status</th>
                    <th>Start</th>
                    <th>Result</th>
                    <th className="text-right">Bets</th>
                    <th className="text-right">Wagered</th>
                    <th className="text-right">Awarded</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rounds.map((r) => (
                    <Fragment key={r.id}>
                      <tr>
                        <td>{GAME_LABELS[r.game]}</td>
                        <td className="font-mono text-xs">{r.code}</td>
                        <td>
                          <StatusPill status={r.status} />
                        </td>
                        <td className="muted whitespace-nowrap text-xs">{fmtTime(r.starts_at)}</td>
                        <td>
                          {r.result !== null ? (
                            <span className="inline-flex items-center gap-2">
                              <strong>{r.result}</strong> <ResultDots number={r.result} />
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">{fmt(r.bet_count)}</td>
                        <td className="text-right tabular-nums">{fmt(r.points_wagered)}</td>
                        <td className="text-right tabular-nums">{fmt(r.points_awarded)}</td>
                        <td>
                          <button className="text-xs text-sky-300 hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                            {open === r.id ? "Hide" : "Details"}
                          </button>
                        </td>
                      </tr>
                      {open === r.id && (
                        <tr>
                          <td colSpan={9} className="bg-navy-950/40 text-xs">
                            <div className="grid gap-1 sm:grid-cols-2">
                              <div>Betting closes: {fmtTime(r.betting_closes_at)}</div>
                              <div>Ends: {fmtTime(r.ends_at)}</div>
                              <div>Result generated: {fmtTime(r.result_at)}</div>
                              <div>Settled: {fmtTime(r.settled_at)}</div>
                              <div className="break-all sm:col-span-2">
                                Commit hash: <span className="font-mono text-slate-300">{r.commit_hash}</span>
                              </div>
                              <div className="break-all sm:col-span-2">
                                Seed:{" "}
                                <span className="font-mono text-slate-300">{r.server_seed ?? "hidden until the round settles"}</span>
                              </div>
                              <div className="sm:col-span-2">
                                <Link href={`/admin/bets?roundCode=${r.code}&game=${r.game}`} className="text-sky-300 hover:underline">
                                  View bets for this round →
                                </Link>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
