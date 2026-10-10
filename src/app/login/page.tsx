"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorText, VirtualNotice } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth, type User } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: User }>("/api/auth/login", { body: { identifier, password } });
      await refresh();
      router.push(user.role === "admin" ? "/admin" : "/play");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-sm">
      <form onSubmit={submit} className="card space-y-4">
        <h1 className="text-2xl font-bold">Log in</h1>
        <div>
          <label className="label" htmlFor="identifier">
            Mobile number
          </label>
          <div className="flex">
            <span className="flex items-center rounded-l-xl border border-r-0 border-navy-600 bg-navy-950/80 px-3 text-slate-400">+91</span>
            <input
              id="identifier"
              className="input rounded-l-none"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="10-digit mobile number"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">Admins: use the Admin login link below.</p>
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <ErrorText error={error} />
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
        <p className="muted text-center text-sm">
          New here?{" "}
          <Link href="/register" className="text-sky-300 hover:underline">
            Create an account
          </Link>
        </p>
        <p className="muted text-center text-xs">
          <Link href="/admin/login" className="hover:underline">
            Admin login
          </Link>
        </p>
      </form>
      <div className="mt-4">
        <VirtualNotice compact />
      </div>
    </div>
  );
}
