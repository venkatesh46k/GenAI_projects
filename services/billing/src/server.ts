import { randomBytes } from "node:crypto";
import { buildApp } from "./app.js";
import { DEFAULT_DB_PATH, openDb } from "./db.js";
import { buildWebApp } from "./web.js";

const logger = { level: process.env.LOG_LEVEL?.toLowerCase() ?? "info" };

// Two listeners, one database. The INTERNAL billing API is what the agents call: unauthenticated, so loopback only.
// The PUBLIC web server is what browsers reach: sign-in, /api, chat, and the built front-end.
const internalHost = process.env.BILLING_HOST ?? "127.0.0.1";
const internalPort = Number(process.env.BILLING_PORT ?? 8000);
const publicHost = process.env.HOST ?? "127.0.0.1"; // a container sets HOST=0.0.0.0
const publicPort = Number(process.env.PORT ?? 8080);

let sessionSecret = process.env.SESSION_SECRET ?? "";
if (sessionSecret.length < 32) {
  if (process.env.NODE_ENV === "production") {
    console.error("SESSION_SECRET must be set to at least 32 characters in production");
    process.exit(1);
  }
  // Development: a fresh secret per start. Everyone is signed out on restart, which is fine locally.
  sessionSecret = randomBytes(32).toString("hex");
  console.warn("SESSION_SECRET is not set: using a temporary one, sessions will not survive a restart");
}

const db = openDb();
const internal = buildApp(db, { logger });
const web = buildWebApp(db, { logger }, {
  sessionSecret,
  cookieSecure: process.env.COOKIE_SECURE === "1",
  staticDir: process.env.WEB_DIST || undefined,
  ai: {
    url: process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8100",
    token: process.env.AI_SERVICE_TOKEN || undefined,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 300_000), // the first answer after a cold start loads the models
    rateLimitPerMinute: Number(process.env.CHAT_RATE_LIMIT_PER_MINUTE ?? 20),
  },
});

async function shutdown(signal: string): Promise<void> {
  web.log.info({ signal }, "shutting down");
  await Promise.all([web.close(), internal.close()]);
  db.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await internal.listen({ port: internalPort, host: internalHost });
  await web.listen({ port: publicPort, host: publicHost });
  web.log.info(
    { db: process.env.BILLING_DB_PATH ?? DEFAULT_DB_PATH, internal: `${internalHost}:${internalPort}`, public: `${publicHost}:${publicPort}` },
    "billing service ready",
  );
} catch (error) {
  web.log.error(error, "failed to start");
  process.exit(1);
}
