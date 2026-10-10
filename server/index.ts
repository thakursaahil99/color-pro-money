import http from "node:http";
import next from "next";
import { config } from "./config";
import { createApp } from "./app";
import { migrate } from "./db/migrate";
import { pool } from "./db/pool";
import { GameEngine } from "./game/engine";

async function main() {
  await migrate();

  const nextApp = next({ dev: !config.isProd, dir: process.cwd() });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();

  // A long-running process: the engine below is driven by a timer, so requests need not advance it.
  const app = createApp({ lazyEngine: false });
  app.all("*", (req, res) => handle(req, res));

  const server = http.createServer(app);
  const engine = new GameEngine();
  await engine.start();
  // Next.js dev mode uses a websocket for hot reload; pass those upgrades through.
  server.on("upgrade", nextApp.getUpgradeHandler());

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") console.error(`Port ${config.port} is already in use. Set PORT (and APP_ORIGIN) in .env to a free port.`);
    else console.error(err);
    process.exit(1);
  });
  server.listen(config.port, () => {
    console.log(`ColorProMoney (virtual points only) running on http://localhost:${config.port}`);
  });

  const shutdown = () => {
    engine.stop();
    server.close(() => void pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
