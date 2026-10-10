"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorText, Spinner, StatusPill } from "@/components/ui";
import { api, fmtTime } from "@/lib/api";

interface AdminRow {
  id: number;
  username: string;
  email: string | null;
  status: string;
  created_at: string;
  last_login_at: string | null;
}

export default function AdminAdmins() {
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ admins: AdminRow[] }>("/api/admin/admins").then((r) => setAdmins(r.admins));
  }, []);
  useEffect(load, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api("/api/admin/admins", { body: form });
      setMessage(`Admin “${form.username}” created. Share the password with them privately.`);
      setForm({ username: "", email: "", password: "" });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className="card">
        <h2 className="mb-3 font-semibold">Admin accounts</h2>
        {!admins ? (
          <Spinner />
        ) : (
          <div className="table-wrap">
            <table className="table !min-w-[480px]">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Last login</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id}>
                    <td className="font-mono text-xs">#{a.id}</td>
                    <td>
                      <Link href={`/admin/users/${a.id}`} className="text-sky-300 hover:underline">
                        {a.username}
                      </Link>
                    </td>
                    <td className="text-xs">{a.email ?? "—"}</td>
                    <td>
                      <StatusPill status={a.status} />
                    </td>
                    <td className="muted text-xs">{fmtTime(a.last_login_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted mt-3 text-xs">To make an existing player an admin (or remove admin rights), open the player under Users.</p>
      </section>

      <form onSubmit={create} className="card space-y-3">
        <h2 className="font-semibold">Create admin</h2>
        <div>
          <label className="label" htmlFor="a-user">
            Username
          </label>
          <input id="a-user" className="input" required pattern="[A-Za-z0-9_]{3,24}" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="a-mail">
            Email (used to log in)
          </label>
          <input id="a-mail" type="email" className="input" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="a-pass">
            Password
          </label>
          <input
            id="a-pass"
            type="password"
            className="input"
            required
            minLength={8}
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <p className="muted mt-1 text-xs">At least 8 characters with a letter and a number. 12+ is better.</p>
        </div>
        <ErrorText error={error} />
        {message && <p className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300">{message}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Creating…" : "Create admin"}
        </button>
      </form>
    </div>
  );
}
