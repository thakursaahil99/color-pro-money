"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorText, PageTitle, RequireAuth, Spinner, Stat } from "@/components/ui";
import { maskMobile } from "@shared/phone";
import { api, fmt, fmtTime } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Referral {
  code: string;
  invited: number;
  earned: number;
  bonusPerReferral: number;
}

interface Profile {
  id: number;
  username: string;
  mobile: string | null;
  role: string;
  created_at: string;
  last_login_at: string | null;
  balance: number;
  total_bets: number;
  wins: number;
  total_wagered: number;
  total_won: number;
}

function ProfileView() {
  const { logout, refresh } = useAuth();
  const router = useRouter();
  const [p, setP] = useState<Profile | null>(null);
  const [ref, setRef] = useState<Referral | null>(null);
  const [copied, setCopied] = useState(false);
  const [nick, setNick] = useState("");
  const [nickMsg, setNickMsg] = useState<string | null>(null);
  const [nickErr, setNickErr] = useState<string | null>(null);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ profile: Profile }>("/api/me/profile").then(({ profile }) => {
      setP(profile);
      setNick(profile.username);
    });
  }, []);

  useEffect(() => {
    api<Referral>("/api/me/referral").then(setRef).catch(() => {});
  }, []);

  if (!p) return <Spinner />;
  const link = ref ? `${window.location.origin}/register?ref=${ref.code}` : "";

  return (
    <>
      <PageTitle title="Profile & settings" subtitle={`Player #${p.id} · joined ${new Date(p.created_at).toLocaleDateString()}`} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Balance" value={`${fmt(p.balance)} VP`} hint="Virtual points" />
        <Stat label="Bets placed" value={fmt(p.total_bets)} hint={`${fmt(p.wins)} wins`} />
        <Stat label="Wagered" value={`${fmt(p.total_wagered)} VP`} />
        <Stat label="Awarded" value={`${fmt(p.total_won)} VP`} />
      </div>

      {ref && (
        <section className="card mb-4 space-y-3">
          <div>
            <h2 className="font-semibold">Invite friends</h2>
            <p className="muted text-sm">
              You get <strong>{fmt(ref.bonusPerReferral)} VP</strong> (virtual points) for every friend who registers with your code.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="input flex-1 font-mono text-lg font-bold tracking-widest">{ref.code}</div>
            <button
              className="btn-primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* clipboard unavailable */
                }
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="muted break-all text-xs">{link}</p>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-navy-950/40 py-2">
              <div className="text-xl font-bold tabular-nums">{fmt(ref.invited)}</div>
              <div className="muted text-xs">Friends joined</div>
            </div>
            <div className="rounded-xl bg-navy-950/40 py-2">
              <div className="text-xl font-bold tabular-nums">{fmt(ref.earned)} VP</div>
              <div className="muted text-xs">Referral earnings</div>
            </div>
          </div>
        </section>
      )}

      <nav className="card mb-4 divide-y divide-navy-700 !p-0" aria-label="Shortcuts">
        {[
          ["/wallet", "Virtual wallet & transactions"],
          ["/trend", "Trend chart"],
          ["/rules", "Rules & payouts"],
          ["/results", "Results & fairness check"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="flex items-center justify-between px-4 py-3 text-sm font-medium">
            {label}
            <span className="muted">›</span>
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 md:grid-cols-2">
        <form
          className="card space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setNickErr(null);
            setNickMsg(null);
            try {
              await api("/api/me/profile", { method: "PATCH", body: { username: nick } });
              setNickMsg("Nickname updated.");
              void refresh();
            } catch (err) {
              setNickErr((err as Error).message);
            }
          }}
        >
          <h2 className="font-semibold">Account</h2>
          <div>
            <span className="label">Mobile number</span>
            <div className="input bg-navy-950/30 text-slate-400">+91 {maskMobile(p.mobile)}</div>
          </div>
          <div>
            <label className="label" htmlFor="nick">
              Nickname
            </label>
            <input id="nick" className="input" pattern="[A-Za-z0-9_]{3,24}" value={nick} onChange={(e) => setNick(e.target.value)} required />
          </div>
          <ErrorText error={nickErr} />
          {nickMsg && <p className="text-sm text-green-300">{nickMsg}</p>}
          <button className="btn-primary">Save</button>
          <p className="muted text-xs">Last login: {fmtTime(p.last_login_at)}</p>
        </form>

        <form
          className="card space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setPwErr(null);
            setPwMsg(null);
            if (pw.newPassword !== pw.confirm) return setPwErr("New passwords do not match");
            try {
              await api("/api/me/password", { body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
              setPw({ currentPassword: "", newPassword: "", confirm: "" });
              setPwMsg("Password changed. Other devices have been signed out.");
            } catch (err) {
              setPwErr((err as Error).message);
            }
          }}
        >
          <h2 className="font-semibold">Change password</h2>
          {(["currentPassword", "newPassword", "confirm"] as const).map((k) => (
            <div key={k}>
              <label className="label" htmlFor={k}>
                {k === "currentPassword" ? "Current password" : k === "newPassword" ? "New password" : "Confirm new password"}
              </label>
              <input
                id={k}
                type="password"
                className="input"
                autoComplete={k === "currentPassword" ? "current-password" : "new-password"}
                value={pw[k]}
                onChange={(e) => setPw({ ...pw, [k]: e.target.value })}
                required
              />
            </div>
          ))}
          <ErrorText error={pwErr} />
          {pwMsg && <p className="text-sm text-green-300">{pwMsg}</p>}
          <button className="btn-primary">Update password</button>
        </form>
      </div>

      <button
        className="btn-ghost mt-4 w-full sm:w-auto"
        onClick={async () => {
          await logout();
          router.push("/login");
        }}
      >
        Log out
      </button>
    </>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileView />
    </RequireAuth>
  );
}
