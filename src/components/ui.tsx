"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { colorsForNumber, type Color, type Selection } from "@shared/game";
import { useAuth } from "@/lib/auth";

export const COLOR_STYLES: Record<Color, { bg: string; ring: string; text: string; label: string; hex: string }> = {
  red: { bg: "bg-game-red", ring: "ring-game-red", text: "text-red-300", label: "Red", hex: "#ef4444" },
  green: { bg: "bg-game-green", ring: "ring-game-green", text: "text-green-300", label: "Green", hex: "#22c55e" },
  violet: { bg: "bg-game-violet", ring: "ring-game-violet", text: "text-violet-300", label: "Violet", hex: "#a855f7" },
};

/** Colour badge: always shows the colour's initial so it never relies on colour alone. */
export function ColorBadge({ color, size = "md", title }: { color: Color; size?: "sm" | "md" | "lg"; title?: string }) {
  const s = COLOR_STYLES[color];
  const dims = size === "sm" ? "h-6 w-6 text-[11px]" : size === "lg" ? "h-12 w-12 text-lg" : "h-8 w-8 text-sm";
  return (
    <span
      title={title ?? s.label}
      aria-label={s.label}
      className={`${s.bg} ${dims} inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow ring-2 ring-white/10`}
    >
      {s.label[0]}
    </span>
  );
}

export const HEX: Record<Color, string> = { red: "#ef4444", green: "#22c55e", violet: "#a855f7" };

/** CSS background for a result number: single colour, or a red/green + violet split for 0 and 5. */
export function numberBackground(n: number): string {
  const c = colorsForNumber(n);
  return c.length === 1 ? HEX[c[0]] : `linear-gradient(135deg, ${HEX[c[0]]} 50%, ${HEX[c[1]]} 50%)`;
}

/** The small coloured dot(s) shown in the "Result" column of record tables. */
export function ResultDots({ number }: { number: number }) {
  return (
    <span className="inline-flex gap-1" title={colorsForNumber(number).join(" + ")}>
      {colorsForNumber(number).map((c) => (
        <span key={c} className="inline-block h-3 w-3 rounded-full" style={{ background: HEX[c] }} aria-label={c} />
      ))}
    </span>
  );
}

/** A bet selection: a colour badge, or a numbered ball. */
export function SelectionBadge({ selection, size = "md" }: { selection: Selection; size?: "sm" | "md" | "lg" }) {
  if (selection === "red" || selection === "green" || selection === "violet") return <ColorBadge color={selection} size={size} />;
  const dims = size === "sm" ? "h-6 w-6 text-[11px]" : size === "lg" ? "h-12 w-12 text-lg" : "h-8 w-8 text-sm";
  return (
    <span
      title={`Number ${selection}`}
      className={`${dims} inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow ring-2 ring-white/10`}
      style={{ background: numberBackground(Number(selection)) }}
    >
      {selection}
    </span>
  );
}

export function selectionLabel(selection: string): string {
  return selection === "red" || selection === "green" || selection === "violet" ? selection[0].toUpperCase() + selection.slice(1) : `Number ${selection}`;
}

export function ColorName({ color }: { color: Color }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`${COLOR_STYLES[color].bg} h-2.5 w-2.5 rounded-full`} aria-hidden />
      {COLOR_STYLES[color].label}
    </span>
  );
}

const PILL: Record<string, string> = {
  won: "bg-green-500/15 text-green-300 border-green-500/30",
  lost: "bg-red-500/10 text-red-300 border-red-500/30",
  pending: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  refunded: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  open: "bg-green-500/15 text-green-300 border-green-500/30",
  closed: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  settled: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  active: "bg-green-500/15 text-green-300 border-green-500/30",
  suspended: "bg-red-500/10 text-red-300 border-red-500/30",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${PILL[status] ?? PILL.refunded}`}>
      {label ?? status}
    </span>
  );
}

export function VirtualNotice({ compact = false }: { compact?: boolean }) {
  return (
    <p className={`rounded-xl border border-sky-500/20 bg-sky-500/5 text-sky-200 ${compact ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm"}`}>
      <strong>Virtual points only.</strong> Points have no cash value and cannot be bought, sold or withdrawn.
    </p>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="card w-full max-w-sm animate-pop" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex items-center justify-between gap-2 text-sm">
      <span className="muted">
        Page {page} of {pages} · {total.toLocaleString()} records
      </span>
      <div className="flex gap-2">
        <button className="btn-ghost px-3 py-1.5" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </button>
        <button className="btn-ghost px-3 py-1.5" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
      {error}
    </p>
  );
}

export function Spinner() {
  return <div className="mx-auto my-10 h-8 w-8 animate-spin rounded-full border-2 border-navy-600 border-t-sky-400" aria-label="Loading" />;
}

/** Client-side guard for nicer UX; the server enforces the same rules on every API call. */
export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace(admin ? "/admin/login" : "/login");
  }, [loading, user, router, admin]);
  if (loading || !user) return <Spinner />;
  if (admin && user.role !== "admin") {
    return (
      <div className="card mx-auto mt-10 max-w-md text-center">
        <h1 className="text-xl font-bold">Admins only</h1>
        <p className="muted mt-2">You do not have access to this area.</p>
        <Link href="/play" className="btn-primary mt-4">
          Back to game
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}

export function PageTitle({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {subtitle && <p className="muted mt-1 text-sm">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
