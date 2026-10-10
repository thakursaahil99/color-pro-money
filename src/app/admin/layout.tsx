"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/ui";
import { useAuth } from "@/lib/auth";

const tabs = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/bets", label: "Bets" },
  { href: "/admin/rounds", label: "Rounds" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/recharges", label: "Recharges" },
  { href: "/admin/referrals", label: "Referrals" },
  { href: "/admin/admins", label: "Admins" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/security", label: "Suspicious" },
  { href: "/admin/audit", label: "Audit log" },
];

type Theme = "light" | "dark";
const THEME_KEY = "cpm-admin-theme";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light") setTheme(saved);
    } catch {
      /* storage unavailable: keep the default */
    }
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
  }

  const themeButton = (
    <button
      onClick={toggleTheme}
      className="rounded-lg border border-navy-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-navy-700"
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
    >
      {theme === "light" ? "🌙 Dark" : "☀️ Light"}
    </button>
  );

  const wrapper = (inner: React.ReactNode) => (
    <div className={`min-h-screen ${theme === "light" ? "app-light bg-[#eef1f5]" : ""}`}>{inner}</div>
  );

  // The admin sign-in page needs no session and no menu.
  if (path === "/admin/login") {
    return wrapper(
      <>
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link href="/" className="font-extrabold tracking-tight">
            ColorPro<span className="text-sky-400">Money</span> <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-bold uppercase text-amber-200">Admin</span>
          </Link>
          {themeButton}
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-10">{children}</main>
      </>,
    );
  }

  return wrapper(
    <>
      <header className="sticky top-0 z-40 border-b border-navy-700 bg-navy-900/90 backdrop-blur" style={theme === "light" ? { background: "rgba(255,255,255,0.92)" } : undefined}>
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/admin" className="flex items-center gap-2 font-extrabold tracking-tight">
            <span className="flex -space-x-1.5" aria-hidden>
              <span className="h-4 w-4 rounded-full bg-game-red ring-2 ring-white/30" />
              <span className="h-4 w-4 rounded-full bg-game-green ring-2 ring-white/30" />
              <span className="h-4 w-4 rounded-full bg-game-violet ring-2 ring-white/30" />
            </span>
            <span>
              ColorPro<span className="text-sky-400">Money</span>
            </span>
            <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-200">Admin</span>
          </Link>
          <div className="flex items-center gap-2">
            {user && <span className="hidden text-sm text-slate-400 sm:inline">{user.username}</span>}
            {themeButton}
            <Link href="/play" className="hidden rounded-lg border border-navy-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-navy-700 sm:inline">
              Player site
            </Link>
            <button
              className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-400"
              onClick={async () => {
                await logout();
                router.push("/admin/login");
              }}
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-12 pt-4">
        <RequireAuth admin>
          <p className="mb-3 text-xs text-slate-500">All values are virtual points. Results cannot be set or changed from this panel.</p>
          <nav className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-navy-700 px-4" aria-label="Admin sections">
            {tabs.map((t) => {
              const active = t.href === "/admin" ? path === "/admin" : path.startsWith(t.href);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${active ? "border-amber-500 text-slate-100" : "border-transparent text-slate-400 hover:text-white"}`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
          {children}
        </RequireAuth>
      </main>
    </>,
  );
}
