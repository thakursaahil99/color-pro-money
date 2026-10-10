"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GAMES, GAME_LABELS, type Game, type PublicRound, type RoundTiming } from "@shared/game";
import { ColorBars, ColorDonut, RoundStacks, type ColorStat, type RoundColumn } from "@/components/Charts";
import { ErrorText, Modal, Spinner, Stat, StatusPill } from "@/components/ui";
import { api, fmt } from "@/lib/api";
import { useGame, useServerNow } from "@/lib/useGame";

interface Overview {
  serverTime: number;
  paused: boolean;
  stats: {
    total_users: number;
    active_users: number;
    suspended_users: number;
    total_wagered: number;
    total_paid: number;
    total_bets: number;
    completed_rounds: number;
    bets_24h: number;
    pending_recharges: number;
  };
  currentRounds: (PublicRound & { bets: number; points: number })[];
  upcoming: RoundTiming[];
}

interface Analytics {
  totalPoints: number;
  totalBets: number;
  colors: ColorStat[];
}

const RANGES = [
  { id: "current", label: "Current round" },
  { id: "24h", label: "24 hours" },
  { id: "7d", label: "7 days" },
  { id: "all", label: "All time" },
] as const;

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function AdminOverview() {
  const live = useGame();
  const now = useServerNow(live.offset, 500);
  const [ov, setOv] = useState<Overview | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("all");
  const [gameFilter, setGameFilter] = useState<Game | "">("");
  const [an, setAn] = useState<Analytics | null>(null);
  const [rounds, setRounds] = useState<RoundColumn[]>([]);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const gameQ = gameFilter ? `&game=${gameFilter}` : "";
    const [o, a, r] = await Promise.all([
      api<Overview>("/api/admin/overview"),
      api<Analytics>(`/api/admin/analytics/colors?range=${range}${gameQ}`),
      api<{ rounds: RoundColumn[] }>(`/api/admin/analytics/rounds?limit=20&game=${gameFilter || "parity"}`),
    ]);
    setOv(o);
    setAn(a);
    setRounds(r.rounds);
  }, [range, gameFilter]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (live.settleCount) void load();
  }, [live.settleCount, load]);

  async function togglePause() {
    if (!ov) return;
    setErr(null);
    try {
      await api("/api/admin/rounds/pause", { body: { paused: !ov.paused, reason } });
      setPauseOpen(false);
      setReason("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (!ov || !an) return <Spinner />;
  const s = ov.stats;
  const current = ov.currentRounds;
  const first = current[0];

  return (
    <div className="space-y-4">
      {s.pending_recharges > 0 && (
        <Link href="/admin/recharges" className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <span>
            <strong>{s.pending_recharges}</strong> recharge request{s.pending_recharges === 1 ? " is" : "s are"} waiting for your approval.
          </span>
          <span className="font-semibold text-amber-300">Review →</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Registered users" value={fmt(s.total_users)} hint={`${fmt(s.suspended_users)} suspended`} />
        <Stat label="Active users" value={fmt(s.active_users)} hint="Seen in last 15 min" />
        <Stat label="Points wagered" value={`${fmt(s.total_wagered)} VP`} hint={`${fmt(s.total_paid)} VP awarded`} />
        <Stat label="Bets placed" value={fmt(s.total_bets)} hint={`${fmt(s.bets_24h)} in last 24h`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Current period</h2>
              <p className="font-mono text-sm text-slate-300">{first?.code ?? "No active period"}</p>
            </div>
            <div className="flex items-center gap-2">
              {ov.paused ? <StatusPill status="suspended" /> : first && <StatusPill status={now < first.bettingClosesAt ? "open" : "closed"} />}
              <button className={ov.paused ? "btn-primary px-3 py-1.5 text-sm" : "btn-ghost px-3 py-1.5 text-sm"} onClick={() => setPauseOpen(true)}>
                {ov.paused ? "Resume rounds" : "Pause new rounds"}
              </button>
            </div>
          </div>
          {ov.paused && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Maintenance mode: no new rounds will start. Any active round finishes normally.
            </p>
          )}
          {first ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-slate-400">Time left</div>
                  <div className="font-mono text-3xl font-bold tabular-nums">{mmss(first.endsAt - now)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Betting window</div>
                  <div className="font-mono text-3xl font-bold tabular-nums">
                    {now < first.bettingClosesAt ? mmss(first.bettingClosesAt - now) : <span className="text-amber-300">closed</span>}
                  </div>
                </div>
              </div>
              <div className="table-wrap mt-4">
                <table className="table !min-w-[420px]">
                  <thead>
                    <tr>
                      <th>Game</th>
                      <th>Status</th>
                      <th className="text-right">Bets</th>
                      <th className="text-right">Points (VP)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.map((r) => (
                      <tr key={r.id}>
                        <td className="font-medium">{GAME_LABELS[r.game]}</td>
                        <td>
                          <StatusPill status={now < r.bettingClosesAt && r.status === "open" ? "open" : "closed"} />
                        </td>
                        <td className="text-right tabular-nums">{fmt(r.bets)}</td>
                        <td className="text-right tabular-nums">{fmt(r.points)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="muted mt-4 text-sm">Waiting for the next period slot.</p>
          )}
        </section>

        <section className="card">
          <h2 className="mb-2 font-semibold">Rounds</h2>
          <div className="mb-3 text-sm">
            <span className="muted">Completed (all games):</span> <strong className="tabular-nums">{fmt(s.completed_rounds)}</strong>
          </div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Upcoming periods</h3>
          {ov.upcoming.length ? (
            <ul className="space-y-1 text-sm">
              {ov.upcoming.map((u) => (
                <li key={u.code} className="flex justify-between">
                  <span className="font-mono">{u.code}</span>
                  <span className="muted">{new Date(u.startsAt).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted text-sm">None scheduled while paused.</p>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Game filter">
        <span className="text-sm text-slate-400">Analytics for:</span>
        {(["", ...GAMES] as const).map((id) => (
          <button
            key={id || "all"}
            role="tab"
            aria-selected={gameFilter === id}
            onClick={() => setGameFilter(id)}
            className={`rounded-lg px-3 py-1 text-xs font-semibold ${gameFilter === id ? "bg-sky-500/20 text-sky-100" : "text-slate-400 hover:text-white"}`}
          >
            {id ? GAME_LABELS[id] : "All games"}
          </button>
        ))}
      </div>

      <section className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Colour-wise betting analytics</h2>
          <div className="flex flex-wrap gap-1" role="tablist">
            {RANGES.map((r) => (
              <button
                key={r.id}
                role="tab"
                aria-selected={range === r.id}
                onClick={() => setRange(r.id)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold ${range === r.id ? "bg-sky-500/20 text-sky-100" : "text-slate-400 hover:text-white"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Virtual points by colour</h3>
            <ColorBars data={an.colors} metric="points" />
            <p className="muted mt-3 text-xs">Total {fmt(an.totalPoints)} VP</p>
          </div>
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Number of bets by colour</h3>
            <ColorBars data={an.colors} metric="bets" />
            <p className="muted mt-3 text-xs">Total {fmt(an.totalBets)} bets</p>
          </div>
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Share of bets</h3>
            <ColorDonut data={an.colors} centerLabel="bets" />
          </div>
        </div>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-slate-400 hover:text-white">Show as table</summary>
          <div className="table-wrap mt-2">
            <table className="table !min-w-0">
              <thead>
                <tr>
                  <th>Colour</th>
                  <th className="text-right">Virtual points</th>
                  <th className="text-right">% points</th>
                  <th className="text-right">Bets</th>
                  <th className="text-right">% bets</th>
                </tr>
              </thead>
              <tbody>
                {an.colors.map((c) => (
                  <tr key={c.color}>
                    <td className="capitalize">{c.color}</td>
                    <td className="text-right tabular-nums">{fmt(c.totalPoints)}</td>
                    <td className="text-right tabular-nums">{c.pointsPct}%</td>
                    <td className="text-right tabular-nums">{fmt(c.betCount)}</td>
                    <td className="text-right tabular-nums">{c.betsPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold">Virtual points per colour · last 20 periods of {GAME_LABELS[gameFilter || "parity"]}</h2>
        <RoundStacks rounds={rounds} />
        <p className="muted mt-2 text-xs">Number under each column = the period&apos;s result (0-9). Results are generated independently of these totals.</p>
      </section>

      <Modal open={pauseOpen} onClose={() => setPauseOpen(false)} title={ov.paused ? "Resume rounds" : "Pause new rounds"}>
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            {ov.paused
              ? "New rounds will start again at the next 3-minute slot."
              : "No new rounds will start. The active round (if any) finishes and settles normally."}{" "}
            This action is recorded in the audit log.
          </p>
          <div>
            <label className="label" htmlFor="reason">
              Reason
            </label>
            <input id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. database maintenance" />
          </div>
          <ErrorText error={err} />
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-ghost" onClick={() => setPauseOpen(false)}>
              Cancel
            </button>
            <button className={ov.paused ? "btn-primary" : "btn-danger"} disabled={reason.trim().length < 3} onClick={togglePause}>
              {ov.paused ? "Resume" : "Pause"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
