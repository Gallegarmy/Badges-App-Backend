import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { closePool } from "./db.ts";

let isShuttingDown = false;

const app = createApp({
  isShuttingDown: () => isShuttingDown,
});

await app.listen({
  host: config.server.host,
  port: config.server.port,
});

console.log(`Backend running on http://${config.server.host}:${config.server.port}`);

const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

for (const signal of shutdownSignals) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

async function shutdown(signal: NodeJS.Signals) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`${signal} received, shutting down...`);

  try {
    await app.close();
    await closePool();
  } catch (error) {
    console.error("Shutdown error", error);
    process.exitCode = 1;
  }
}
