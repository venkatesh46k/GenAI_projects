import { buildApp } from "./app.js";
import { DEFAULT_DB_PATH, openDb } from "./db.js";

const port = Number(process.env.PORT ?? 8000);
// Loopback by default: this service is internal, reached by the web tier and the agents on the same host.
const host = process.env.HOST ?? "127.0.0.1";

const db = openDb();
const app = buildApp(db, { logger: { level: process.env.LOG_LEVEL?.toLowerCase() ?? "info" } });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close();
  db.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port, host });
  app.log.info({ db: process.env.BILLING_DB_PATH ?? DEFAULT_DB_PATH }, "billing service ready");
} catch (error) {
  app.log.error(error, "failed to start");
  process.exit(1);
}
