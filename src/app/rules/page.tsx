import { BET_AMOUNTS, GAMES, GAME_LABELS } from "@shared/game";
import { VirtualNotice } from "@/components/ui";

export const metadata = { title: "Rules & payouts · ColorProMoney" };

const PAYOUTS: [string, string, string][] = [
  ["Join Green", "Result is 1, 3, 7 or 9", "2x"],
  ["Join Green", "Result is 5 (green + violet)", "1.5x"],
  ["Join Red", "Result is 2, 4, 6 or 8", "2x"],
  ["Join Red", "Result is 0 (red + violet)", "1.5x"],
  ["Join Violet", "Result is 0 or 5", "4.5x"],
  ["A number 0-9", "Result is exactly that number", "9x"],
];

export default function RulesPage() {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Rules & payouts</h1>
        <p className="muted text-sm">Everything you need to know before you play.</p>
      </div>
      <VirtualNotice />

      <section className="card space-y-2">
        <h2 className="font-bold">How a period works</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-300">
          <li>
            There are four games: {GAMES.map((g) => GAME_LABELS[g]).join(", ")}. Each has its own result every period, with its own period number.
          </li>
          <li>A new period starts every 3 minutes (180 seconds), at the same time for everyone.</li>
          <li>You can place one bet per game per period, for the first 150 seconds. Betting locks 30 seconds before the end.</li>
          <li>Choose <strong>Join Green / Violet / Red</strong>, or one number from 0 to 9, then pick your contract money: {BET_AMOUNTS.join(", ")} virtual points.</li>
          <li>At zero the result number (0-9) is revealed to everyone at once and winning bets are credited.</li>
        </ol>
      </section>

      <section className="card space-y-2">
        <h2 className="font-bold">Colours of the numbers</h2>
        <ul className="space-y-1 text-sm text-slate-300">
          <li>
            <strong style={{ color: "#16a34a" }}>Green</strong>: 1, 3, 7, 9
          </li>
          <li>
            <strong style={{ color: "#dc2626" }}>Red</strong>: 2, 4, 6, 8
          </li>
          <li>
            <strong style={{ color: "#dc2626" }}>Red</strong> + <strong style={{ color: "#9333ea" }}>Violet</strong>: 0
          </li>
          <li>
            <strong style={{ color: "#16a34a" }}>Green</strong> + <strong style={{ color: "#9333ea" }}>Violet</strong>: 5
          </li>
        </ul>
      </section>

      <section className="card">
        <h2 className="mb-2 font-bold">Payouts</h2>
        <p className="muted mb-2 text-sm">Your points back, multiplied (your stake is included). A losing bet loses its stake.</p>
        <table className="table !min-w-0">
          <thead>
            <tr>
              <th>You bet</th>
              <th>You win when</th>
              <th className="text-right">Pays</th>
            </tr>
          </thead>
          <tbody>
            {PAYOUTS.map(([bet, when, pays], i) => (
              <tr key={i}>
                <td className="font-medium">{bet}</td>
                <td className="text-sm">{when}</td>
                <td className="text-right font-bold tabular-nums">{pays}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted mt-2 text-xs">Example: 100 VP on number 7, result 7 → you receive 900 VP.</p>
      </section>

      <section className="card space-y-2">
        <h2 className="font-bold">Fairness</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-300">
          <li>When a period is created, the server draws a 256-bit secret seed from a cryptographically secure random number generator.</li>
          <li>The SHA-256 hash of that seed is shown on the game screen <em>before</em> betting opens.</li>
          <li>The result number is computed only from the seed, the game and the period, with unbiased sampling. Bets and amounts play no part.</li>
          <li>After the period the seed is revealed on the Search page, where you can verify the hash and recompute the result yourself.</li>
          <li>Results are stored in an append-only table. Nobody, including administrators, can change them.</li>
        </ul>
      </section>

      <section className="card space-y-2">
        <h2 className="font-bold">Virtual points</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-300">
          <li>New accounts receive free starting virtual points.</li>
          <li>Virtual points have no monetary value. They cannot be purchased, sold, transferred or withdrawn.</li>
          <li>There are no deposits, recharges, payments or cash prizes of any kind.</li>
        </ul>
      </section>
    </div>
  );
}
