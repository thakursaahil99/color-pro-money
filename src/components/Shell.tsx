"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { fmt } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const TABS = [
  { href: "/play", label: "Home", icon: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" },
  { href: "/results", label: "Search", icon: "M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5" },
  { href: "/history", label: "Win", icon: "M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3" },
  { href: "/profile", label: "My", icon: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function AppHeader() {
  const { user, balance, refresh } = useAuth();
  const path = usePathname();
  const [spin, setSpin] = useState(false);
  const onPlay = path === "/play";

  return (
    <header className="bg-[#16a394] px-4 pb-3 pt-3 text-white shadow">
      {user ? (
        <>
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-semibold" title="Virtual points - no cash value">
              Available Balance: <span className="tabular-nums">{fmt(balance)}</span> VP
            </div>
            <button
              aria-label="Refresh balance"
              className="rounded-full p-1.5 hover:bg-white/15"
              onClick={async () => {
                setSpin(true);
                await refresh();
                setTimeout(() => setSpin(false), 500);
              }}
            >
              <svg viewBox="0 0 24 24" className={`h-5 w-5 ${spin ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" />
              </svg>
            </button>
          </div>
          {onPlay && (
            <div className="mt-2 flex gap-2">
              <Link href="/rules" className="rounded bg-sky-500 px-4 py-1.5 text-xs font-bold tracking-wide text-white shadow-sm">
                RULES
              </Link>
              <Link href="/trend" className="rounded bg-white/90 px-4 py-1.5 text-xs font-bold tracking-wide text-[#16a394] shadow-sm">
                TREND
              </Link>
              <Link href="/recharge" className="ml-auto rounded bg-amber-400 px-4 py-1.5 text-xs font-bold tracking-wide text-slate-900 shadow-sm">
                RECHARGE
              </Link>
              <Link href="/wallet" className="rounded bg-white/20 px-3 py-1.5 text-xs font-bold tracking-wide text-white">
                WALLET
              </Link>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <span className="flex -space-x-1.5" aria-hidden>
              <span className="h-4 w-4 rounded-full bg-game-red ring-2 ring-[#16a394]" />
              <span className="h-4 w-4 rounded-full bg-game-green ring-2 ring-[#16a394]" />
              <span className="h-4 w-4 rounded-full bg-game-violet ring-2 ring-[#16a394]" />
            </span>
            ColorProMoney
          </Link>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Link href="/login" className="rounded px-3 py-1.5 hover:bg-white/15">
              Log in
            </Link>
            <Link href="/register" className="rounded bg-white px-3 py-1.5 text-[#16a394]">
              Sign up
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const path = usePathname();
  return (
    <div className="app-light min-h-screen bg-[#dfe5ea]">
      <div className="mx-auto min-h-screen max-w-md bg-[#f1f4f7] shadow-xl">
        <AppHeader />
        <main className={`px-3 pt-3 ${user ? "pb-24" : "pb-10"}`}>
          {children}
        </main>
        {user && (
          <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 mx-auto grid max-w-md grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
            {TABS.map((t) => {
              const active = path === t.href || (t.href === "/profile" && ["/wallet", "/rules"].includes(path)) || (t.href === "/play" && ["/trend", "/recharge"].includes(path));
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${active ? "text-[#16a394]" : "text-slate-500"}`}
                >
                  <Icon d={t.icon} />
                  {t.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}

/** Players get the light phone-style layout; the admin area has its own layout. */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  // The admin area draws its own header, menu and theme (see src/app/admin/layout.tsx).
  if (path.startsWith("/admin")) return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}
