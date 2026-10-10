"use client";

import { useEffect, useState } from "react";
import { GAMES, GAME_LABELS, type Game } from "@shared/game";
import { ErrorText, Spinner } from "@/components/ui";
import { api } from "@/lib/api";

interface Settings {
  startingPoints: number;
  referralBonus: number;
  registrationOpen: boolean;
  gamesEnabled: Record<Game, boolean>;
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-green-500" : "bg-slate-400"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export default function AdminSettings() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ settings: Settings }>("/api/admin/settings").then(({ settings }) => {
      setSaved(settings);
      setDraft(settings);
    });
  }, []);

  if (!draft || !saved) return <Spinner />;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { settings } = await api<{ settings: Settings }>("/api/admin/settings", { method: "PUT", body: draft });
      setSaved(settings);
      setDraft(settings);
      setMessage("Settings saved. The change is recorded in the audit log.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const num = (k: "startingPoints" | "referralBonus") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({ ...draft, [k]: e.target.value === "" ? 0 : Math.max(0, Math.floor(Number(e.target.value))) });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">New players</h2>
          <p className="muted text-sm">These apply to accounts created from now on. Existing accounts are not changed.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="start">
              Starting virtual points
            </label>
            <input id="start" type="number" min={0} max={1000000} className="input" value={draft.startingPoints} onChange={num("startingPoints")} />
            <p className="muted mt-1 text-xs">0 means new accounts start empty.</p>
          </div>
          <div>
            <label className="label" htmlFor="bonus">
              Referral bonus (virtual points)
            </label>
            <input id="bonus" type="number" min={0} max={100000} className="input" value={draft.referralBonus} onChange={num("referralBonus")} />
            <p className="muted mt-1 text-xs">Paid to the referrer for each friend who registers with their code.</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-navy-600 px-4 py-3">
          <div>
            <div className="font-medium">Registration open</div>
            <div className="muted text-xs">Turn off to stop new sign-ups. Existing players can still log in.</div>
          </div>
          <Toggle on={draft.registrationOpen} label="Registration open" onChange={(v) => setDraft({ ...draft, registrationOpen: v })} />
        </div>
      </section>

      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">Games</h2>
          <p className="muted text-sm">A game you switch off finishes its running period (bets are settled normally) and then stops opening new ones. To stop everything, use “Pause new rounds” on the Overview.</p>
        </div>
        {GAMES.map((g) => (
          <div key={g} className="flex items-center justify-between gap-3 rounded-xl border border-navy-600 px-4 py-3">
            <div className="font-medium">{GAME_LABELS[g]}</div>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-semibold ${draft.gamesEnabled[g] ? "text-green-300" : "text-red-300"}`}>{draft.gamesEnabled[g] ? "On" : "Off"}</span>
              <Toggle on={draft.gamesEnabled[g]} label={`${GAME_LABELS[g]} enabled`} onChange={(v) => setDraft({ ...draft, gamesEnabled: { ...draft.gamesEnabled, [g]: v } })} />
            </div>
          </div>
        ))}
      </section>

      <ErrorText error={error} />
      {message && <p className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300">{message}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={!dirty || busy} onClick={save}>
          {busy ? "Saving…" : "Save settings"}
        </button>
        <button className="btn-ghost" disabled={!dirty || busy} onClick={() => setDraft(saved)}>
          Reset changes
        </button>
      </div>

      <section className="card">
        <h2 className="mb-1 font-semibold">Fixed by design</h2>
        <p className="muted text-sm">
          Round length (3 minutes), betting window, result generation and payout rules are not editable here. Results come from a secure random
          generator and nobody, including admins, can change or influence them.
        </p>
      </section>
    </div>
  );
}
