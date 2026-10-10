# ColorProMoney

A 3-minute "Parity"-style colour and number prediction game (Green / Violet / Red, or a number 0-9) with a mobile-app player screen and an admin panel.

> **Virtual points only.** No real money, deposits, payments, cash prizes or withdrawals. Points have no cash value.

Every tool used here is free and open source: Next.js, React, Tailwind, Express, `ws` and PostgreSQL. No paid services or API keys are needed.

---

## Features

**Players**: sign up and log in with a **mobile number** + password (nickname optional, auto-generated if blank), start with 0 virtual points and **ask an admin for free points (100 or 500) from the Recharge page** (no payment of any kind; betting is blocked until points arrive), **invite friends with a referral code and earn 150 VP for each one**, profile, nickname and password change, virtual points balance, a server-synced 3-minute countdown, four games with unique period numbers, bets on a colour or a number 0-9, chips (10/50/100/500/1000), a confirm-before-bet dialog, live results (polled every 2 s), betting history, transaction ledger, rules page and a public results page with one-click fairness verification.

**Admins** (separate login at `/admin/login`, email or username; light and dark theme toggle):
- **Overview:** users, active users, points wagered, bets, the current period of every game with a live countdown, completed and upcoming rounds, colour-wise analytics (points, bet counts, % share, charts) with a per-game filter, and **pause/resume new rounds**.
- **Bets / Rounds:** filterable bet records (game, selection, user, period, status); round list with result number, seed and timestamps; a betting-window monitor.
- **Users:** search by ID, mobile or nickname; full activity; **edit nickname and mobile, reset a player's password, sign out everywhere, suspend/reinstate with a reason, make or remove admin rights**.
- **Recharges:** every recharge request with **Approve / Reject** (a reason is required to reject); approving credits the points once and is audited. The overview shows how many are waiting.
- **Referrals:** who invited whom and the bonus paid.
- **Admins:** list admin accounts and create new ones.
- **Settings:** starting points for new players, referral bonus, registration on/off, and an on/off switch for each of the four games.
- **Suspicious activity** and an immutable, hash-chained **audit log** that records every one of the actions above.

**There is no feature that sets, changes or influences results.** The database itself also blocks result changes (see Security).

## How the game works

| | |
|---|---|
| Games | four run side by side: **Parity, Sapre, Bcone, Emerd**, each with its own result per period |
| Period length | exactly 180 s, aligned to fixed epoch slots so every server and client computes the same schedule |
| Betting window | first 150 s; locks 30 s before the end |
| Period number | `YYYYMMDDNNN` (UTC date + round of the day, 001-480) |
| Result | a number 0-9 plus a 5-digit "price" ending in that number |
| Bets | one per player per game per period; **Join Green / Violet / Red** or a number 0-9; 10, 50, 100, 500 or 1000 VP |

**Colours:** 1, 3, 7, 9 are green; 2, 4, 6, 8 are red; **0 is red + violet; 5 is green + violet**.

| You bet | You win when the result is | Pays (stake included) |
|---|---|---|
| Green | 1, 3, 7, 9 | 2× |
| Green | 5 | 1.5× |
| Red | 2, 4, 6, 8 | 2× |
| Red | 0 | 1.5× |
| Violet | 0 or 5 | 4.5× |
| A number | exactly that number | **9×** |

**Fairness (commit-reveal):** when a round is created the server draws a 256-bit seed from the OS CSPRNG (`crypto.randomBytes`) and publishes only `SHA-256(seed)`. The result number is `HMAC-SHA256(seed, "game:period:counter")` with rejection sampling, so all ten numbers are exactly equally likely. The Search page recomputes it in your browser. It never reads bets, amounts or users. After settlement the seed is revealed so anyone can check it.

## Project structure

```
server/                 Node.js backend (local/Docker: one process with API + game engine + Next.js; Vercel: the same API as a serverless function)
  index.ts              entry point
  app.ts                Express API factory (used by tests too)
  config.ts             environment config
  db/migrations/        SQL schema (tables, constraints, indexes, immutability triggers)
  db/migrate.ts         migration runner          db/seed.ts   demo-only mock data
  game/engine.ts        round lifecycle: open -> closed -> settled
  game/betting.ts       atomic bet placement      game/settlement.ts  atomic payouts
  game/rounds.ts        round queries             game/clock.ts       server clock
  lib/                  auth & sessions, scrypt passwords, RNG, rate limiter, audit, errors
  game/lazy.ts          serverless mode: engine advanced by requests
  routes/               auth, me, game, admin REST endpoints
  scripts/create-admin.ts   secure admin setup (CLI only)
shared/game.ts          rules shared by server + UI (timing, chips, payout, message types)
src/app/                Next.js pages (player + /admin)
src/components/, src/lib/   UI components, API client, auth context, polling game-state hook
tests/                  Vitest tests
```

### Database tables

`users` (unique mobile number, optional email), `sessions`, `virtual_wallets`, `virtual_wallet_transactions`, `game_rounds`, `game_results`, `bets`, `admin_audit_logs`, plus `security_events` (suspicious-activity signals), `system_settings` (pause flag) and `schema_migrations`.

The tables use foreign keys, unique constraints and `created_at` timestamps, plus indexes on the hot paths. A few constraints worth knowing:

- `UNIQUE (user_id, round_id)` allows one bet per player per round
- `UNIQUE (user_id, client_nonce)` blocks replayed requests
- `UNIQUE (bet_id, type)` means a bet is debited once and paid once
- `balance >= 0` means a wallet can never go negative

---

## Run it locally (Windows, macOS, Linux)

**Requirements:** Node.js 20 or newer and PostgreSQL 14 or newer (you already have PostgreSQL 17 installed).

```bash
# 1. Install dependencies
npm install

# 2. Create two databases (enter your postgres password when asked)
createdb -U postgres colorpromoney
createdb -U postgres colorpromoney_test
#   Windows: the tools are in "C:\Program Files\PostgreSQL\17\bin\" (or use pgAdmin -> Create -> Database)

# 3. Configure
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
#   then edit .env: put your real postgres password in DATABASE_URL and TEST_DATABASE_URL

# 4. Create tables
npm run db:migrate

# 5. Create the admin account (secure setup: CLI only, password shown once)
npm run admin:create -- --username admin --email you@example.com
#   or choose the password yourself:  ADMIN_PASSWORD='YourLongPass123' npm run admin:create

# 6. (Optional) demo data: 8 mock players and 24 played rounds. Needs DEMO_MODE=true
npm run db:seed             # demo login: mobile 9000000001 / password DemoPlayer123

# 7. Start
npm run dev                 # development, http://localhost:3000
# or production:
npm run build && npm start
```

Open http://localhost:3000. Players sign up with a 10-digit Indian mobile number (`+91`, spaces and dashes are accepted). Admins log in with their **username** (`admin`) to see **Admin** in the menu.

> Mobile numbers are not verified by SMS OTP, because every SMS gateway is a paid service. `/api/auth/register` is the single place to add an OTP step later if you decide to pay for one.

> **Port already in use?** Set `PORT` and `APP_ORIGIN` in `.env` to a free port (e.g. `PORT=4791`, `APP_ORIGIN=http://localhost:4791`).
>
> **"Cannot find module ./NNN.js"?** Stop every server for this project, delete the `.next` and `.next-dev` folders, and start again. Dev mode builds into `.next-dev` and production into `.next`, so they no longer clash.

### Run the tests

```bash
npm test
```

This runs 98 tests across 10 files. Integration tests need `TEST_DATABASE_URL`, and **that database is wiped on every run**. For safety, its name must contain `test`.

| File | Covers |
|---|---|
| `timer.test.ts` | 180 s rounds, exact lock/end deadlines, shared schedule, unique round IDs |
| `rng.test.ts` | CSPRNG seeds, deterministic result from seed, commit hash, chi-square uniformity |
| `betting.test.ts` | window edges (±1 ms), late or closed rounds, invalid chips, duplicate/replay/concurrent bets, untrusted client balance |
| `accounting.test.ts` | colour and number payouts, four games settled independently, wallet equals ledger, idempotent settlement, result independent of bets, immutability |
| `engine.test.ts` | open → close → settle on the server clock, pause, catching up after downtime, server time in the API |
| `access.test.ts` | 401/403 on every admin route, no result-setting API, CSRF, private-data leaks, password hashing, rate limits, audit trail |

---

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `TEST_DATABASE_URL` | separate database for tests (wiped on each run) |
| `DATABASE_SSL` | `true` for hosted Postgres (Neon, Supabase, Render) |
| `PORT`, `APP_ORIGIN` | port, and the public URL (used for cross-site request checks) |
| `SESSION_TTL_HOURS` | session lifetime (default 168) |
| `STARTING_POINTS` | virtual points new accounts start with (default **0**) |
| `REFERRAL_BONUS_POINTS` | virtual points a referrer gets per friend who registers with their code (default **150**) |
| `DB_POOL_MAX` | max database connections (default 10, or 2 on Vercel) |
| `DEMO_MODE` | `true` allows `db:seed`. **Keep `false` in production.** |
| `TRUST_PROXY` | set to `1` behind a reverse proxy or hosting platform so client IPs are correct |

Secrets live only in `.env`, which git ignores. Never commit it.

---

## Deploy for free

### Option A: Vercel (website + API) + Neon (free Postgres)

On Vercel there is no always-on server and no WebSockets, so in this mode:
- the browser **polls** the game state every 2 seconds (the countdown still uses the server's clock);
- the game engine is advanced **by incoming requests**: whenever someone loads the game, rounds are opened, closed and settled, and anything missed while nobody was around is settled first. With nobody online, no new periods are created, and that is fine because there is nobody to play.

Steps:

1. **Database:** create a free project at **neon.tech**. Copy the **pooled** connection string (the host contains `-pooler`).
2. **Code:** push this project to a GitHub repository (`.env` is git-ignored, so your secrets are not uploaded).
3. **Vercel:** at vercel.com choose *Add New > Project*, import the repo (framework: Next.js is detected). Add these **Environment Variables**:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Neon pooled connection string |
   | `DATABASE_SSL` | `true` |
   | `TRUST_PROXY` | `1` |
   | `DEMO_MODE` | `false` |
   | `STARTING_POINTS` | `0` (or any number) |
   | `REFERRAL_BONUS_POINTS` | `150` |

   Then click **Deploy**. The build runs `vercel-build`, which **creates/updates the database tables automatically** and then builds the site.
4. **Admin account:** on your own PC, point `DATABASE_URL` in `.env` at the Neon database (temporarily) and run
   `npm run admin:create -- --username admin --email you@example.com`. The password is printed once. Then restore your `.env`.
5. Open your `https://<project>.vercel.app` address and log in as `admin`.

Free-tier notes: Neon pauses an idle database and wakes it on the first request (a second or two of delay). The login rate limiter is kept in memory per function instance, so on Vercel it slows brute-force attempts rather than hard-limiting them.

### Option B: Render (web) + Neon (database)

A long-running server, so the engine runs on its own timer and results appear instantly even with no visitors.

1. Create a free Postgres database at **neon.tech** and copy its connection string.
2. Push this project to GitHub.
3. On **render.com**, create a **Web Service** from the repo (Free plan):
   - Build command: `npm install --include=dev && npm run build`
   - Start command: `npm start`
   - Environment: `DATABASE_URL=<neon url>`, `DATABASE_SSL=true`, `APP_ORIGIN=https://<your-app>.onrender.com`, `TRUST_PROXY=1`, `DEMO_MODE=false`
4. Once it's live, open the Render **Shell** and run `npm run admin:create -- --username admin --email you@example.com`.

The free tier sleeps after about 15 minutes with no visitors. When it wakes, the engine automatically settles any rounds it missed and starts the next one.

### Option C: Oracle Cloud "Always Free" VM. Always on, $0.

1. Create an Always Free Ubuntu VM and install Docker.
2. Copy the project to it, then create `.env` with `POSTGRES_PASSWORD=<strong password>` and `APP_ORIGIN=https://your-domain`.
3. Start it: `docker compose up -d --build`
4. Create the admin: `docker compose exec app npx tsx server/scripts/create-admin.ts --username admin --email you@example.com`
5. Add free HTTPS with **Caddy** (`reverse_proxy localhost:3000`), or use a free **Cloudflare Tunnel** if you have no public IP.

Migrations run automatically every time the server starts.

### Production checklist

- Use HTTPS. Session cookies become `Secure` and `__Host-` prefixed in production.
- Set `DEMO_MODE=false`, use a strong database password, and set `TRUST_PROXY=1` behind a proxy.
- Settlement is lock-protected and idempotent, so several instances cannot settle a round twice. The rate limiter is in-memory per instance.
- Back up the database regularly. Neon and Render include point-in-time backups.

---

## Security summary

- **Passwords:** scrypt (memory-hard, built into Node) with a per-user salt. Comparisons are constant-time, and unknown users still get a dummy hash so login timing doesn't reveal which accounts exist.
- **Sessions:** random 256-bit tokens in `httpOnly`, `SameSite=Lax` cookies. Only their SHA-256 hash is stored. Sessions are revoked on logout, suspension and password change.
- **Server-side permissions:** `requireUser` and `requireAdmin` protect every route. The UI guard is only for convenience.
- **Never trust the client:** amount, colour and round are validated on the server. Timing uses the server clock, and the balance comes from the database. A bet locks the wallet row (`FOR UPDATE`) and the round row (`FOR SHARE`) inside a transaction.
- **No duplicates, replays or late bets:** unique constraints, single-use UUID nonces, and a deadline check made while the round row is locked.
- **Transactions everywhere:** every point movement writes a ledger row in the same transaction, so the wallet balance always equals the sum of the ledger.
- **Results can't be changed:** database triggers reject any UPDATE or DELETE on results, ledger entries and audit logs. They also reject changes to a round's seed or schedule, re-opening a settled round, and edits to settled bets.
- **Audit logs:** append-only and SHA-256 hash-chained. They record every admin action (pause, suspend, reinstate, user views) plus system round events.
- **Rate limits:** login, registration, bets, password changes and admin APIs. Rate-limit hits are recorded as security events.
- **Cross-site request protection:** SameSite cookies, a JSON-only body requirement, and an Origin check.
- **Privacy:** public endpoints carry only round timing and results, never usernames, emails or other players' bets.

## API reference (all under `/api`)

| Method & path | Access | Purpose |
|---|---|---|
| `POST /auth/register` `{mobile, password, username?}` · `POST /auth/login` `{identifier, password}` · `POST /auth/logout` · `GET /auth/me` | public / user | accounts (identifier = mobile, or username for admins) |
| `GET /me/referral` | user | your code, friends joined, referral earnings |
| `GET/POST /me/recharge` `{amount: 100 or 500}` | user | list your recharge requests / ask for free points |
| `GET /me/profile` · `PATCH /me/profile` · `POST /me/password` | user | profile and settings |
| `GET /me/bets` · `GET /me/transactions` | user | history |
| `GET /game/state` · `GET /game/results?game=&page=` | public | current period of every game, server time, result records with revealed seeds |
| `POST /game/bets` `{roundId, selection, amount, nonce}` (`selection` = `green`/`violet`/`red`/`0`-`9`) | user | place a bet |
| `GET /admin/overview` · `/admin/analytics/colors?range=` · `/admin/analytics/rounds` | admin | dashboard |
| `GET /admin/bets` · `/admin/rounds` · `POST /admin/rounds/pause` | admin | records and rounds |
| `GET /admin/users` · `/admin/users/:id` · `/admin/suspicious` · `PATCH /admin/users/:id` | admin | user management and editing |
| `POST /admin/users/:id/reset-password` · `/logout` · `/role` | admin | reset password, sign out everywhere, admin rights |
| `GET /admin/recharges` · `POST /admin/recharges/:id/approve` · `/reject` `{reason}` | admin | approve or reject recharge requests |
| `GET/PUT /admin/settings` · `GET /admin/referrals` · `GET/POST /admin/admins` | admin | settings, referrals, admin accounts |
| `POST /admin/users/:id/suspend` · `/unsuspend` `{reason}` | admin | moderation |
| `GET /admin/audit` · `/admin/audit/verify` | admin | audit trail |
