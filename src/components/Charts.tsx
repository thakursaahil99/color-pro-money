"use client";

import { useState } from "react";
import { COLORS, type Color } from "@shared/game";
import { fmt } from "@/lib/api";
import { COLOR_STYLES, numberBackground } from "./ui";

type Group = Color | "numbers";
/** Colour bets keep their colour; every bet on a number 0-9 is shown as one neutral "Numbers" group. */
const STYLE: Record<Group, { label: string; hex: string }> = { ...COLOR_STYLES, numbers: { label: "Numbers 0-9", hex: "#94a3b8" } };

export interface ColorStat {
  color: Group;
  totalPoints: number;
  betCount: number;
  pointsPct: number;
  betsPct: number;
}

/** Horizontal bars, one per colour, direct-labelled with name, value and share. */
export function ColorBars({ data, metric }: { data: ColorStat[]; metric: "points" | "bets" }) {
  const value = (d: ColorStat) => (metric === "points" ? d.totalPoints : d.betCount);
  const pct = (d: ColorStat) => (metric === "points" ? d.pointsPct : d.betsPct);
  const max = Math.max(1, ...data.map(value));
  return (
    <ul className="space-y-3" aria-label={metric === "points" ? "Virtual points by colour" : "Bets by colour"}>
      {data.map((d) => (
        <li key={d.color} className="group" title={`${STYLE[d.color].label}: ${fmt(value(d))} ${metric === "points" ? "VP" : "bets"} (${pct(d)}%)`}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-medium text-slate-200">{STYLE[d.color].label}</span>
            <span className="tabular-nums text-slate-300">
              {fmt(value(d))} {metric === "points" ? "VP" : "bets"} <span className="text-slate-500">· {pct(d)}%</span>
            </span>
          </div>
          <div className="h-3 w-full rounded bg-navy-950/70">
            <div
              className="h-3 rounded-r transition-[width] duration-500 group-hover:brightness-110"
              style={{ width: `${(value(d) / max) * 100}%`, background: STYLE[d.color].hex, minWidth: value(d) ? 4 : 0 }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Donut of the bet-count share, with a 2px surface gap between segments and a labelled legend. */
export function ColorDonut({ data, centerLabel }: { data: ColorStat[]; centerLabel: string }) {
  const [hover, setHover] = useState<Group | null>(null);
  const total = data.reduce((a, d) => a + d.betCount, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const shown = hover ? data.find((d) => d.color === hover) : null;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <svg viewBox="0 0 140 140" className="h-40 w-40 shrink-0" role="img" aria-label="Share of bets by colour">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#0a1128" strokeWidth="18" />
        {total > 0 &&
          data.map((d) => {
            const len = (d.betCount / total) * c;
            const gap = d.betCount > 0 && d.betCount < total ? 2 : 0;
            const el = (
              <circle
                key={d.color}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={STYLE[d.color].hex}
                strokeWidth={hover === d.color ? 20 : 18}
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                strokeDashoffset={-acc}
                transform="rotate(-90 70 70)"
                onMouseEnter={() => setHover(d.color)}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer transition-all"
              />
            );
            acc += len;
            return el;
          })}
        <text x="70" y="66" textAnchor="middle" className="fill-slate-100 text-[18px] font-bold">
          {shown ? `${shown.betsPct}%` : fmt(total)}
        </text>
        <text x="70" y="84" textAnchor="middle" className="fill-slate-400 text-[10px]">
          {shown ? STYLE[shown.color].label : centerLabel}
        </text>
      </svg>
      <ul className="w-full space-y-2 text-sm">
        {data.map((d) => (
          <li
            key={d.color}
            className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1 ${hover === d.color ? "bg-navy-700/60" : ""}`}
            onMouseEnter={() => setHover(d.color)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm" style={{ background: STYLE[d.color].hex }} aria-hidden />
              {STYLE[d.color].label}
            </span>
            <span className="tabular-nums text-slate-300">
              {fmt(d.betCount)} bets · {d.betsPct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface RoundColumn {
  code: string;
  status: string;
  result: number | null;
  red: number;
  green: number;
  violet: number;
}

/** Stacked columns of virtual points per colour for recent rounds, with the result marked below. */
export function RoundStacks({ rounds }: { rounds: RoundColumn[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rounds.map((r) => Number(r.red) + Number(r.green) + Number(r.violet)));
  const H = 160;
  if (!rounds.length) return <p className="muted text-sm">No rounds yet.</p>;
  const h = hover !== null ? rounds[hover] : null;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-slate-300">
        {COLORS.map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_STYLES[c].hex }} aria-hidden /> {COLOR_STYLES[c].label}
          </span>
        ))}
        <span className="ml-auto min-h-[1rem] tabular-nums text-slate-400">
          {h
            ? `${h.code}: R ${fmt(h.red)} · G ${fmt(h.green)} · V ${fmt(h.violet)} VP${h.result !== null ? ` · result ${h.result}` : ""}`
            : "Hover a column for details"}
        </span>
      </div>
      <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ height: H + 34 }}>
        {rounds.map((r, i) => {
          const segs = COLORS.map((c) => ({ c, v: Number(r[c]) })).filter((s) => s.v > 0);
          return (
            <div
              key={r.code}
              className="flex min-w-[22px] flex-1 cursor-default flex-col items-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className={`flex w-full max-w-[28px] flex-col justify-end gap-[2px] ${hover === i ? "brightness-110" : ""}`}
                style={{ height: H }}
              >
                {[...segs].reverse().map((s, k) => (
                  <div
                    key={s.c}
                    style={{ height: Math.max(2, (s.v / max) * H), background: COLOR_STYLES[s.c].hex }}
                    className={k === 0 ? "rounded-t" : ""}
                  />
                ))}
              </div>
              <div className="mt-1 h-5">
                {r.result !== null ? (
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: numberBackground(r.result) }}
                    title={`Result: ${r.result}`}
                  >
                    {r.result}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500">…</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
