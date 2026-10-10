"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorText } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth, type User } from "@/lib/auth";

export default function AdminLoginPage() {
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
      if (user.role !== "admin") {
        // A player account signed in here: end that session again, it has no business in the admin area.
        await api("/api/auth/logout", { method: "POST" }).catch(() => {});
        setError("This account is not an admin account. Players log in on the normal login page.");
        return;
      }
      await refresh();
      router.push("/admin");
    } catch (err) {
      setError((err as Error).message.replace("mobile number", "email / username"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <form onSubmit={submit} className="card space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Admin login</h1>
          <p className="muted mt-1 text-sm">Sign in with your admin email or username.</p>
        </div>
        <div>
          <label className="label" htmlFor="identifier">
            Email or username
          </label>
          <input id="identifier" className="input" autoComplete="username" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
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
          {busy ? "Logging in…" : "Log in as admin"}
        </button>
        <p className="muted text-center text-sm">
          <Link href="/login" className="text-sky-300 hover:underline">
            ← Player login
          </Link>
        </p>
      </form>
    </div>
  );
}
