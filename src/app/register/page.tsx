"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorText, VirtualNotice } from "@/components/ui";
import { normalizeMobile } from "@shared/phone";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [form, setForm] = useState({ mobile: "", username: "", ref: "", password: "", confirm: "" });
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  // An invite link looks like /register?ref=ABCD1234
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ref");
    if (code) setForm((f) => ({ ...f, ref: code.toUpperCase() }));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!normalizeMobile(form.mobile)) return setError("Enter a valid 10-digit mobile number");
    if (form.password !== form.confirm) return setError("Passwords do not match");
    setBusy(true);
    try {
      await api("/api/auth/register", { body: { mobile: form.mobile, username: form.username, ref: form.ref, password: form.password } });
      await refresh();
      router.push("/play");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-sm">
      <form onSubmit={submit} className="card space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Create account</h1>
          <p className="muted mt-1 text-sm">You&apos;ll start with free virtual points.</p>
        </div>
        <div>
          <label className="label" htmlFor="mobile">
            Mobile number
          </label>
          <div className="flex">
            <span className="flex items-center rounded-l-xl border border-r-0 border-navy-600 bg-navy-950/80 px-3 text-slate-400">+91</span>
            <input
              id="mobile"
              className="input rounded-l-none"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="10-digit mobile number"
              required
              value={form.mobile}
              onChange={set("mobile")}
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="username">
            Nickname <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id="username"
            className="input"
            autoComplete="nickname"
            pattern="[A-Za-z0-9_]{3,24}"
            title="3-24 letters, numbers or underscores"
            placeholder="Leave blank to get one automatically"
            value={form.username}
            onChange={set("username")}
          />
        </div>
        <div>
          <label className="label" htmlFor="ref">
            Referral code <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id="ref"
            className="input uppercase"
            autoComplete="off"
            maxLength={20}
            placeholder="Code from the friend who invited you"
            value={form.ref}
            onChange={set("ref")}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.password}
            onChange={set("password")}
          />
          <p className="mt-1 text-xs text-slate-400">At least 8 characters, including a letter and a number.</p>
        </div>
        <div>
          <label className="label" htmlFor="confirm">
            Confirm password
          </label>
          <input id="confirm" type="password" className="input" autoComplete="new-password" required value={form.confirm} onChange={set("confirm")} />
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
          I understand this game uses virtual points only, with no real-money value, deposits or withdrawals.
        </label>
        <ErrorText error={error} />
        <button className="btn-primary w-full" disabled={busy || !agree}>
          {busy ? "Creating account…" : "Create account"}
        </button>
        <p className="muted text-center text-sm">
          Already registered?{" "}
          <Link href="/login" className="text-sky-300 hover:underline">
            Log in
          </Link>
        </p>
      </form>
      <div className="mt-4">
        <VirtualNotice compact />
      </div>
    </div>
  );
}
