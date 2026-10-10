"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { GAME_LABELS, type Game, type Selection } from "@shared/game";
import { ErrorText, Modal, SelectionBadge, Spinner, Stat, StatusPill, selectionLabel } from "@/components/ui";
import { api, fmt, fmtTime } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Detail {
  user: {
    id: number;
    username: string;
    mobile: string | null;
    email: string | null;
    role: string;
    status: string;
    suspended_reason: string | null;
    suspended_at: string | null;
    failed_login_count: number;
    created_at: string;
    last_login_at: string | null;
    last_seen_at: string | null;
    is_demo: boolean;
    balance: number;
  };
  stats: { bets: number; wins: number; wagered: number; awarded: number; distinct_ips: number };
  bets: { id: number; game: Game; round_code: string; selection: Selection; amount: number; status: string; payout: number; created_at: string; ip: string | null }[];
  transactions: { id: number; type: string; amount: number; balance_after: number; description: string | null; created_at: string }[];
  sessions: { id: number; ip: string | null; user_agent: string | null; created_at: string; last_seen_at: string; expires_at: string; revoked_at: string | null }[];
  securityEvents: { id: number; type: string; details: Record<string, unknown>; ip: string | null; created_at: string }[];
  adminActions: { id: number; action: string; details: { reason?: string }; created_at: string; admin_username: string | null }[];
  referral: { referred_by: string | null; referrals_made: number; referral_earned: number; referral_code: string };
}

type Manage = "none" | "edit" | "password" | "role";

/** Account management: edit details, reset password, sign out, change admin rights. Every action is audited. */
function ManageAccount({ d, selfId, reload }: { d: Detail; selfId: number | undefined; reload: () => void }) {
  const u = d.user;
  const isSelf = u.id === selfId;
  const [open, setOpen] = useState<Manage>("none");
  const [username, setUsername] = useState(u.username);
  const [mobile, setMobile] = useState(u.mobile ?? "");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(done);
      setOpen("none");
      setPassword("");
      setReason("");
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (m: Manage) => {
    setError(null);
    setMessage(null);
    setOpen(open === m ? "none" : m);
  };

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Manage account</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => toggle("edit")}>
            Edit details
          </button>
          {u.role === "user" && !isSelf && (
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => toggle("password")}>
              Reset password
            </button>
          )}
          <button
            className="btn-ghost px-3 py-1.5 text-sm"
            disabled={busy}
            onClick={() => {
              if (confirm(`Sign ${u.username} out of all devices?`)) void run(() => api(`/api/admin/users/${u.id}/logout`, { method: "POST", body: {} }), "Signed out of all devices.");
            }}
          >
            Sign out everywhere
          </button>
          {!isSelf && (
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => toggle("role")}>
              {u.role === "admin" ? "Remove admin rights" : "Make admin"}
            </button>
          )}
        </div>
      </div>

      {open === "edit" && (
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            const body: Record<string, string> = {};
            if (username !== u.username) body.username = username;
            if (mobile !== (u.mobile ?? "") && mobile.trim() !== "") body.mobile = mobile;
            void run(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body }), "Details updated.");
          }}
        >
          <div>
            <label className="label" htmlFor="m-user">
              Nickname
            </label>
            <input id="m-user" className="input" pattern="[A-Za-z0-9_]{3,24}" required value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="m-mobile">
              Mobile number
            </label>
            <input id="m-mobile" className="input" inputMode="tel" placeholder="10-digit number" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      )}

      {open === "password" && (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api(`/api/admin/users/${u.id}/reset-password`, { body: { password } }), "Password changed and the player was signed out everywhere. Tell them the new password privately.");
          }}
        >
          <div>
            <label className="label" htmlFor="m-pass">
              New password for {u.username}
            </label>
            <input id="m-pass" type="text" className="input" required minLength={8} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="muted mt-1 text-xs">At least 8 characters with a letter and a number. The password is never stored in the audit log.</p>
          </div>
          <div className="flex items-end">
            <button className="btn-danger" disabled={busy}>
              Reset password
            </button>
          </div>
        </form>
      )}

      {open === "role" && (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => api(`/api/admin/users/${u.id}/role`, { body: { role: u.role === "admin" ? "user" : "admin", reason } }),
              u.role === "admin" ? "Admin rights removed." : "This player is now an admin.",
            );
          }}
        >
          <div>
            <label className="label" htmlFor="m-reason">
              Reason ({u.role === "admin" ? "remove admin rights" : "make admin"})
            </label>
            <input id="m-reason" className="input" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Min 5 characters, saved in the audit log" />
          </div>
          <div className="flex items-end">
            <button className={u.role === "admin" ? "btn-danger" : "btn-primary"} disabled={busy}>
              {u.role === "admin" ? "Remove admin rights" : "Make admin"}
            </button>
          </div>
        </form>
      )}

      <ErrorText error={error} />
      {message && <p className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300">{message}</p>}
      <p className="muted text-xs">
        Referral code <span className="font-mono">{d.referral.referral_code}</span> · {d.referral.referred_by ? `referred by ${d.referral.referred_by}` : "not referred"} · invited{" "}
        {d.referral.referrals_made} ({fmt(d.referral.referral_earned)} VP earned)
      </p>
    </section>
  );
}

export default function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const { user: me } = useAuth();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [reason, setReason] = useState("");
  const [actionErr, setActionErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Detail>(`/api/admin/users/${id}`)
      .then(setD)
      .catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <ErrorText error={error} />;
  if (!d) return <Spinner />;
  const u = d.user;
  const suspended = u.status === "suspended";
  const canSuspend = u.role !== "admin" && u.id !== me?.id;

  async function act() {
    setActionErr(null);
    try {
      await api(`/api/admin/users/${u.id}/${suspended ? "unsuspend" : "suspend"}`, { body: { reason } });
      setModal(false);
      setReason("");
      load();
    } catch (e) {
      setActionErr((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <Link href="/admin/users" className="text-sm text-sky-300 hover:underline">
        ← All users
      </Link>
      <section className="card flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {u.username} <span className="font-mono text-base text-slate-400">#{u.id}</span>
          </h1>
          <p className="muted text-sm">
            {u.mobile ? `+91 ${u.mobile}` : u.email ?? "no contact"} · {u.role} · joined {fmtTime(u.created_at)}
          </p>
          <p className="muted text-sm">
            Last login {fmtTime(u.last_login_at)} · last seen {fmtTime(u.last_seen_at)} · failed logins {u.failed_login_count}
          </p>
          {suspended && (
            <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              Suspended {fmtTime(u.suspended_at)}: {u.suspended_reason}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={u.status} />
          {canSuspend && (
            <button className={suspended ? "btn-primary text-sm" : "btn-danger text-sm"} onClick={() => setModal(true)}>
              {suspended ? "Reinstate" : "Suspend"}
            </button>
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Balance" value={`${fmt(u.balance)} VP`} />
        <Stat label="Bets" value={fmt(d.stats.bets)} hint={`${fmt(d.stats.wins)} won`} />
        <Stat label="Wagered" value={`${fmt(d.stats.wagered)} VP`} />
        <Stat label="Awarded" value={`${fmt(d.stats.awarded)} VP`} />
        <Stat label="Distinct bet IPs" value={fmt(d.stats.distinct_ips)} />
      </div>

      <ManageAccount key={`${u.id}-${u.username}-${u.mobile}-${u.role}`} d={d} selfId={me?.id} reload={load} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-2 font-semibold">Recent bets</h2>
          <div className="table-wrap">
            <table className="table !min-w-[480px]">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Selection</th>
                  <th className="text-right">VP</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {d.bets.map((b) => (
                  <tr key={b.id}>
                    <td className="font-mono text-xs">
                      {GAME_LABELS[b.game]} {b.round_code}
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-2">
                        <SelectionBadge selection={b.selection} size="sm" />
                        {selectionLabel(b.selection)}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{fmt(b.amount)}</td>
                    <td>
                      <StatusPill status={b.status} />
                    </td>
                    <td className="muted text-xs">{fmtTime(b.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.bets.length === 0 && <p className="muted text-sm">No bets.</p>}
        </section>

        <section className="card">
          <h2 className="mb-2 font-semibold">Security signals</h2>
          {d.securityEvents.length === 0 ? (
            <p className="muted text-sm">No suspicious activity recorded.</p>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
              {d.securityEvents.map((e) => (
                <li key={e.id} className="flex justify-between gap-2 border-b border-navy-700/60 pb-1.5">
                  <span>
                    <span className="font-medium text-amber-200">{e.type.replace(/_/g, " ")}</span>
                    {e.ip && <span className="muted text-xs"> · {e.ip}</span>}
                  </span>
                  <span className="muted whitespace-nowrap text-xs">{fmtTime(e.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="mb-2 font-semibold">Virtual point transactions</h2>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
            {d.transactions.map((t) => (
              <li key={t.id} className="flex justify-between gap-2 border-b border-navy-700/60 pb-1.5">
                <span className="muted text-xs">{t.description ?? t.type}</span>
                <span className={`tabular-nums ${t.amount > 0 ? "text-green-300" : "text-red-300"}`}>
                  {t.amount > 0 ? "+" : ""}
                  {fmt(t.amount)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="mb-2 font-semibold">Sessions</h2>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto text-xs">
            {d.sessions.map((s) => (
              <li key={s.id} className="border-b border-navy-700/60 pb-1.5">
                <div className="flex justify-between">
                  <span>{s.ip ?? "unknown IP"}</span>
                  <span className={s.revoked_at ? "text-slate-500" : new Date(s.expires_at) > new Date() ? "text-green-300" : "text-slate-500"}>
                    {s.revoked_at ? "revoked" : new Date(s.expires_at) > new Date() ? "active" : "expired"}
                  </span>
                </div>
                <div className="muted truncate">{s.user_agent}</div>
                <div className="muted">
                  started {fmtTime(s.created_at)} · last seen {fmtTime(s.last_seen_at)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <h2 className="mb-2 font-semibold">Admin actions on this account</h2>
        {d.adminActions.length === 0 ? (
          <p className="muted text-sm">None.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {d.adminActions.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 border-b border-navy-700/60 pb-1.5">
                <span>
                  <strong>{a.action.replace(/_/g, " ")}</strong> by {a.admin_username ?? "system"}
                  {a.details?.reason && <span className="muted"> — {a.details.reason}</span>}
                </span>
                <span className="muted text-xs">{fmtTime(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={modal} onClose={() => setModal(false)} title={suspended ? `Reinstate ${u.username}` : `Suspend ${u.username}`}>
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            {suspended
              ? "The user will be able to log in again."
              : "The user will be signed out of all devices and blocked from logging in."}{" "}
            A reason is required and will be stored in the audit log.
          </p>
          <textarea className="input min-h-[90px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (min 5 characters)" />
          <ErrorText error={actionErr} />
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-ghost" onClick={() => setModal(false)}>
              Cancel
            </button>
            <button className={suspended ? "btn-primary" : "btn-danger"} disabled={reason.trim().length < 5} onClick={act}>
              {suspended ? "Reinstate" : "Suspend"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
