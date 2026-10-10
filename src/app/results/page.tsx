"use client";

import { useEffect, useState } from "react";
import { GAMES, GAME_LABELS, type Game } from "@shared/game";
import { Pagination, ResultDots, Spinner, numberBackground } from "@/components/ui";
import { api, fmtTime, qs } from "@/lib/api";

interface Result {
  code: string;
  game: Game;
  number: number;
  price: number;
  commit_hash: string;
  server_seed: string;
  created_at: string;
}

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Recomputes the result number exactly as the server does: HMAC-SHA256(seed, "game:period:counter"), rejection-sampled. */
async function drawNumber(seed: string, game: string, code: string): Promise<number> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(seed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  for (let counter = 0; counter < 1000; counter++) {
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${game}:${code}:${counter}`)));
    const byte = digest.find((b) => b < 250);
    if (byte !== undefined) return byte % 10;
  }
  return -1;
}

export default function ResultsPage() {
  const [game, setGame] = useState<Game>("parity");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ results: Result[]; total: number; pageSize: number } | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setData(null);
    api<{ results: Result[]; total: number; pageSize: number }>(`/api/game/results${qs({ game, page, pageSize: 15 })}`).then(setData);
  }, [game, page]);

  async function verify(r: Result) {
    const ok = (await sha256Hex(r.server_seed)) === r.commit_hash && (await drawNumber(r.server_seed, r.game, r.code)) === r.number;
    setVerified((v) => ({ ...v, [`${r.game}${r.code}`]: ok }));
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Results & fairness</h1>
        <p className="muted text-sm">
          Each period&apos;s secret seed was fixed (hashed) before betting opened. After the result the seed is revealed, so you can check it.
        </p>
      </div>

      <div className="flex rounded-md bg-white shadow-sm" role="tablist" aria-label="Games">
        {GAMES.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={game === id}
            onClick={() => {
              setGame(id);
              setPage(1);
            }}
            className={`flex-1 border-b-2 py-2.5 text-sm font-semibold ${game === id ? "border-[#16a394] text-[#16a394]" : "border-transparent text-slate-500"}`}
          >
            {GAME_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="card">
        {!data ? (
          <Spinner />
        ) : (
          <>
            <ul className="divide-y divide-navy-700">
              {data.results.map((r) => {
                const key = `${r.game}${r.code}`;
                return (
                  <li key={key} className="py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold text-white"
                        style={{ background: numberBackground(r.number) }}
                      >
                        {r.number}
                      </span>
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="font-mono text-xs font-semibold text-slate-700">{r.code}</div>
                        <div className="muted text-xs">
                          Price {r.price} · {fmtTime(r.created_at)}
                        </div>
                      </div>
                      <ResultDots number={r.number} />
                      {key in verified ? (
                        <span className={`text-xs font-semibold ${verified[key] ? "text-green-300" : "text-red-300"}`}>{verified[key] ? "✓ verified" : "✗ mismatch"}</span>
                      ) : (
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => verify(r)}>
                          Verify
                        </button>
                      )}
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-slate-500">Seed & hash</summary>
                      <p className="mt-1 break-all font-mono text-[10px] leading-snug text-slate-500">seed {r.server_seed}</p>
                      <p className="break-all font-mono text-[10px] leading-snug text-slate-500">hash {r.commit_hash}</p>
                    </details>
                  </li>
                );
              })}
              {data.results.length === 0 && <li className="muted py-6 text-center text-sm">No results yet.</li>}
            </ul>
            <Pagination page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
