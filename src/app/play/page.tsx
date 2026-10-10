"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BET_AMOUNTS,
  GAMES,
  GAME_LABELS,
  NUMBERS,
  displayMultiplier,
  payoutFor,
  type Game,
  type Selection,
} from "@shared/game";
import {
  ErrorText,
  HEX,
  Modal,
  RequireAuth,
  ResultDots,
  SelectionBadge,
  Spinner,
  StatusPill,
  numberBackground,
  selectionLabel,
} from "@/components/ui";
import { api, fmt, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useGame, useServerNow } from "@/lib/useGame";

interface MyBet {
  id: number;
  round_id: number;
  selection: Selection;
  amount: number;
  status: string;
  payout: number;
}

interface RecordRow {
  code: string;
  number: number;
  price: number;
}

interface MyRecordRow {
  id: number;
  round_code: string;
  selection: Selection;
  amount: number;
  status: string;
  payout: number;
  result_number: number | null;
}

const PAGE_SIZE = 10;

function splitTime(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return { mm, ss };
}

function Digits({ text, tone }: { text: string; tone: "ok" | "locked" }) {
  return (
    <span className="inline-flex gap-1">
      {text.split("").map((d, i) => (
        <span
          key={i}
          className={`flex h-8 w-6 items-center justify-center rounded text-lg font-bold tabular-nums text-white ${tone === "locked" ? "bg-red-600" : "bg-slate-800"}`}
        >
          {d}
        </span>
      ))}
    </span>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
      <button className="rounded border border-slate-300 bg-white px-3 py-1 font-medium disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹ Prev
      </button>
      <span>
        {page} / {pages}
      </span>
      <button className="rounded border border-slate-300 bg-white px-3 py-1 font-medium disabled:opacity-40" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next ›
      </button>
    </div>
  );
}

function Home() {
  const g = useGame();
  const now = useServerNow(g.offset);
  const { balance, setBalance, refresh } = useAuth();

  const [game, setGame] = useState<Game>("parity");
  const [pick, setPick] = useState<Selection | null>(null);
  const [amount, setAmount] = useState<number>(BET_AMOUNTS[0]);
  const [agree, setAgree] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [myBets, setMyBets] = useState<Record<number, MyBet>>({});
  const [tab, setTab] = useState<"game" | "mine">("game");
  const [recPage, setRecPage] = useState(1);
  const [mineRoundsPage, setMineRoundsPage] = useState(1);
  const [records, setRecords] = useState<{ rows: RecordRow[]; total: number } | null>(null);
  const [mine, setMine] = useState<{ rows: MyRecordRow[]; total: number } | null>(null);

  const round = g.rounds[game];
  const roundKey = Object.values(g.rounds)
    .map((r) => r?.id)
    .join(",");

  const loadMyBets = useCallback(async () => {
    const s = await api<{ myBets: MyBet[] }>("/api/game/state").catch(() => null);
    if (s) setMyBets((prev) => ({ ...prev, ...Object.fromEntries(s.myBets.map((b) => [b.round_id, b])) }));
  }, []);

  useEffect(() => {
    void loadMyBets();
  }, [roundKey, loadMyBets]);

  // Record tables
  useEffect(() => {
    api<{ results: RecordRow[]; total: number }>(`/api/game/results${qs({ game, page: recPage, pageSize: PAGE_SIZE })}`)
      .then((r) => setRecords({ rows: r.results, total: r.total }))
      .catch(() => {});
  }, [game, recPage, g.settleCount]);
  useEffect(() => {
    api<{ bets: MyRecordRow[]; total: number }>(`/api/me/bets${qs({ game, page: mineRoundsPage, pageSize: PAGE_SIZE })}`)
      .then((r) => setMine({ rows: r.bets, total: r.total }))
      .catch(() => {});
  }, [game, mineRoundsPage, g.settleCount, roundKey]);

  // When a round settles: refresh balance and tell the player how their bet went.
  useEffect(() => {
    const r = g.lastResult;
    if (!r) return;
    void refresh();
    const bet = myBets[r.roundId];
    if (bet) {
      const won = payoutFor(bet.selection, bet.amount, r.number);
      setNotice(
        won > 0
          ? `${GAME_LABELS[r.game]} ${r.code}: result ${r.number}. You won ${fmt(won)} VP!`
          : `${GAME_LABELS[r.game]} ${r.code}: result ${r.number}. Your bet did not win.`,
      );
      const t = setTimeout(() => setNotice(null), 8000);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.settleCount]);

  const phase = useMemo(() => {
    if (!round) return g.paused || g.disabled.includes(game) ? "paused" : "waiting";
    return now < round.bettingClosesAt && round.status === "open" ? "betting" : "locked";
  }, [round, now, g.paused, g.disabled, game]);

  const myBet = round ? myBets[round.id] : undefined;
  const toEnd = round ? round.endsAt - now : 0;
  const toLock = round ? round.bettingClosesAt - now : 0;
  const { mm, ss } = splitTime(toEnd);
  const MIN_BET = BET_AMOUNTS[0];
  const broke = balance < MIN_BET; // cannot afford even the smallest bet: ask for a recharge instead
  const canJoin = phase === "betting" && !myBet && toLock > 1000 && !broke;
  const tone = phase === "locked" ? "locked" : "ok";

  function open(selection: Selection) {
    setError(null);
    setPick(selection);
  }

  async function confirm() {
    if (!round || !pick) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ bet: MyBet & { roundId: number }; balance: number }>("/api/game/bets", {
        body: { roundId: round.id, selection: pick, amount, nonce: crypto.randomUUID() },
      });
      setBalance(res.balance);
      setMyBets((p) => ({ ...p, [round.id]: { ...res.bet, round_id: round.id } }));
      setPick(null);
      setNotice(`Bet placed: ${fmt(amount)} VP on ${selectionLabel(res.bet.selection)}.`);
      setTimeout(() => setNotice(null), 4000);
    } catch (err) {
      setError((err as Error).message);
      setPick(null);
    } finally {
      setBusy(false);
    }
  }

  const joinBtn = (label: string, selection: Selection, color: string) => (
    <button
      key={selection}
      disabled={!canJoin}
      onClick={() => open(selection)}
      className="rounded-md py-2.5 text-[13px] font-bold text-white shadow transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
      style={{ background: color }}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      {/* Game tabs */}
      <div className="flex rounded-md bg-white shadow-sm" role="tablist" aria-label="Games">
        {GAMES.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={game === id}
            onClick={() => {
              setGame(id);
              setRecPage(1);
              setMineRoundsPage(1);
            }}
            className={`flex-1 border-b-2 py-2.5 text-sm font-semibold ${game === id ? "border-[#16a394] text-[#16a394]" : "border-transparent text-slate-500"}`}
          >
            {GAME_LABELS[id]}
          </button>
        ))}
      </div>

      {notice && (
        <p role="status" className="rounded-md border border-[#a7ddd6] bg-[#e6f6f4] px-3 py-2 text-sm font-medium text-[#0b7a70]">
          {notice}
        </p>
      )}
      <ErrorText error={error} />

      {/* Period + countdown */}
      <section className="flex items-center justify-between rounded-md bg-white p-3 shadow-sm">
        <div>
          <div className="flex items-center gap-1.5 text-sm text-slate-600">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-500" fill="currentColor" aria-hidden>
              <path d="M7 3h10v4a5 5 0 01-4 4.9V15h3v2H8v-2h3v-3.1A5 5 0 017 7V3zM4 5h3v2a2 2 0 01-2 2H4V5zm16 0h-3v2a2 2 0 002 2h1V5zM8 19h8v2H8z" />
            </svg>
            Period
          </div>
          <div className="mt-1 font-mono text-lg font-bold tracking-wide text-slate-800">{round?.code ?? "—————"}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-slate-600">Count Down</div>
          {phase === "paused" ? (
            <div className="mt-1 text-sm font-bold text-amber-600">Paused</div>
          ) : phase === "waiting" ? (
            <div className="mt-1 text-sm font-bold text-slate-500">Starting…</div>
          ) : (
            <div className="mt-1 flex items-center justify-end gap-1" role="timer" aria-label={`${mm} minutes ${ss} seconds left`}>
              <Digits text={mm} tone={tone} />
              <span className="font-bold text-slate-700">:</span>
              <Digits text={ss} tone={tone} />
            </div>
          )}
        </div>
      </section>

      {broke && (
        <section className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 shadow-sm">
          <div className="text-sm text-amber-900">
            <div className="font-bold">Not enough points to play</div>
            <div className="text-xs">You need at least {MIN_BET} VP to place a bet. Recharge to continue.</div>
          </div>
          <Link href="/recharge" className="shrink-0 rounded bg-amber-400 px-4 py-2 text-xs font-extrabold tracking-wide text-slate-900 shadow-sm">
            RECHARGE
          </Link>
        </section>
      )}

      {/* Join + number buttons */}
      <section className="space-y-3 rounded-md bg-white p-3 shadow-sm">
        <div className="grid grid-cols-3 gap-2">
          {joinBtn("Join Green", "green", HEX.green)}
          {joinBtn("Join Violet", "violet", HEX.violet)}
          {joinBtn("Join Red", "red", HEX.red)}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {NUMBERS.map((n) => (
            <button
              key={n}
              disabled={!canJoin}
              onClick={() => open(String(n) as Selection)}
              aria-label={`Number ${n}, pays ${displayMultiplier(String(n) as Selection)}`}
              className="flex h-10 items-center justify-center rounded-md text-base font-bold text-white shadow transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
              style={{ background: numberBackground(n) }}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="text-center text-[11px] text-slate-500">
          {phase === "betting" && !myBet && `Betting closes in ${splitTime(toLock).mm}:${splitTime(toLock).ss} · Green/Red 2x · Violet 4.5x · Number 9x`}
          {phase === "locked" && "Betting closed for this period. Result at zero."}
          {phase === "paused" && (g.disabled.includes(game) ? `${GAME_LABELS[game]} is switched off for now. Try another game.` : "New periods are paused for maintenance.")}
          {phase === "waiting" && "The next period starts shortly."}
          {myBet && phase === "betting" && "You already placed your bet in this period."}
        </p>
        {myBet && (
          <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-2.5">
            <SelectionBadge selection={myBet.selection} />
            <div className="flex-1 text-sm">
              Your bet: <strong>{fmt(myBet.amount)} VP</strong> on <strong>{selectionLabel(myBet.selection)}</strong>
              <div className="text-xs text-slate-500">Potential win up to {fmt(Math.floor((myBet.amount * (myBet.selection === "red" || myBet.selection === "green" ? 20 : myBet.selection === "violet" ? 45 : 90)) / 10))} VP</div>
            </div>
            <StatusPill status={myBet.status} />
          </div>
        )}
      </section>

      {/* Records */}
      <section className="rounded-md bg-white p-3 shadow-sm">
        <div className="mb-3 flex justify-center gap-2 text-sm font-semibold">
          <button
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 ${tab === "game" ? "bg-[#16a394] text-white" : "bg-slate-100 text-slate-600"}`}
            onClick={() => setTab("game")}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
              <path d="M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5h.01" />
            </svg>
            {GAME_LABELS[game]} Record
          </button>
          <button
            className={`rounded-full px-4 py-1.5 ${tab === "mine" ? "bg-[#16a394] text-white" : "bg-slate-100 text-slate-600"}`}
            onClick={() => setTab("mine")}
          >
            My Record
          </button>
        </div>

        {tab === "game" ? (
          !records ? (
            <Spinner />
          ) : (
            <>
              <table className="w-full text-center text-sm">
                <thead>
                  <tr className="text-xs text-slate-500">
                    <th className="py-1.5 text-left font-semibold">Period</th>
                    <th className="font-semibold">Price</th>
                    <th className="font-semibold">Number</th>
                    <th className="text-right font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {records.rows.map((r) => (
                    <tr key={r.code} className="border-t border-slate-100">
                      <td className="py-2 text-left font-mono text-xs text-slate-700">{r.code}</td>
                      <td className="tabular-nums text-slate-700">{r.price}</td>
                      <td className="font-bold tabular-nums" style={{ color: r.number % 2 ? HEX.green : HEX.red }}>
                        {r.number}
                      </td>
                      <td className="text-right">
                        <ResultDots number={r.number} />
                      </td>
                    </tr>
                  ))}
                  {records.rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-slate-500">
                        No results yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <Pager page={recPage} total={records.total} onPage={setRecPage} />
            </>
          )
        ) : !mine ? (
          <Spinner />
        ) : (
          <>
            <table className="w-full text-center text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="py-1.5 text-left font-semibold">Period</th>
                  <th className="font-semibold">Select</th>
                  <th className="font-semibold">Points</th>
                  <th className="text-right font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {mine.rows.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="py-2 text-left font-mono text-xs text-slate-700">{b.round_code}</td>
                    <td>
                      <span className="inline-flex">
                        <SelectionBadge selection={b.selection} size="sm" />
                      </span>
                    </td>
                    <td className="tabular-nums text-slate-700">{fmt(b.amount)}</td>
                    <td className="text-right">
                      {b.status === "pending" ? (
                        <StatusPill status="pending" />
                      ) : b.status === "won" ? (
                        <span className="font-semibold text-green-600">+{fmt(b.payout)}</span>
                      ) : (
                        <span className="font-semibold text-red-500">-{fmt(b.amount)}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {mine.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-slate-500">
                      You have not played {GAME_LABELS[game]} yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pager page={mineRoundsPage} total={mine.total} onPage={setMineRoundsPage} />
          </>
        )}
      </section>

      {/* Bet popup */}
      <Modal open={pick !== null} onClose={() => setPick(null)} title={pick ? `Join ${selectionLabel(pick)}` : ""}>
        {pick && round && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <SelectionBadge selection={pick} size="lg" />
              <div className="text-sm text-slate-600">
                {GAME_LABELS[game]} · Period <span className="font-mono font-semibold">{round.code}</span>
                <div className="text-xs">Pays {displayMultiplier(pick)} your points on a win</div>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-sm font-semibold text-slate-700">Contract money (virtual points)</div>
              <div className="grid grid-cols-5 gap-2">
                {BET_AMOUNTS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAmount(a)}
                    aria-pressed={amount === a}
                    className={`rounded-md border py-2 text-sm font-bold tabular-nums ${
                      amount === a ? "border-[#16a394] bg-[#16a394] text-white" : "border-slate-300 bg-white text-slate-700"
                    } ${balance < a ? "opacity-40" : ""}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-600">Total contract money</span>
              <strong className="tabular-nums">{fmt(amount)} VP</strong>
            </div>
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              I agree to the rules. Virtual points only, no cash value. Bets are final once placed.
            </label>
            {balance < amount && (
              <p className="text-xs font-semibold text-red-600">
                Not enough virtual points for this amount.{" "}
                <Link href="/recharge" className="underline">
                  Recharge
                </Link>
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost" onClick={() => setPick(null)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy || !agree || balance < amount || toLock <= 0} onClick={confirm}>
                {busy ? "Placing…" : "Confirm"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function PlayPage() {
  return (
    <RequireAuth>
      <Home />
    </RequireAuth>
  );
}
