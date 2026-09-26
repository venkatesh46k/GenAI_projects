import { randomInt, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { openDb, run } from "./db.js";

const PLANS = [
  ["PLAN_199", "Basic 199", 199.0, 28, 1.5, 1000, 100],
  ["PLAN_599", "Premium 599", 599.0, 56, 2.5, 3000, 100],
  ["PLAN_99", "Data Topup 99", 99.0, 30, 1.0, 0, 0],
] as const;

const SUBSCRIBERS = [
  ["9876543210", "PLAN_199", 45.5, "active", "2026-09-10"],
  ["9123456780", "PLAN_599", 120.0, "active", "2026-09-05"],
  ["9988776655", "PLAN_199", 5.0, "barred", "2026-08-20"],
] as const;

const CALL_TYPES = ["voice", "sms", "data"] as const;
const round2 = (value: number) => Math.round(value * 100) / 100;
const between = (low: number, high: number) => round2(low + Math.random() * (high - low));

/** Reset the demo data. Idempotent: mutable tables are cleared, so re-seeding always returns to the same start. */
export function seed(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const plan of PLANS) run(db, "INSERT OR REPLACE INTO plans VALUES (?,?,?,?,?,?,?)", ...plan);
    for (const sub of SUBSCRIBERS) run(db, "INSERT OR REPLACE INTO subscribers VALUES (?,?,?,?,?)", ...sub);
    run(db, "DELETE FROM cdrs");
    run(db, "DELETE FROM disputes");
    run(db, "DELETE FROM transactions");

    const now = Date.now();
    for (const [msisdn] of SUBSCRIBERS) {
      for (let i = 0; i < 10; i++) {
        const when = new Date(now - randomInt(0, 21) * 86_400_000).toISOString();
        run(
          db,
          "INSERT INTO cdrs VALUES (?,?,?,?,?,?,?)",
          randomUUID().slice(0, 8),
          msisdn,
          CALL_TYPES[randomInt(0, CALL_TYPES.length)] ?? "voice",
          randomInt(10, 601),
          between(1, 500),
          between(0.5, 5),
          when,
        );
      }
    }

    const created = new Date().toISOString();
    run(db, "INSERT INTO disputes VALUES (?,?,?,?,?,?)", "D-100001", "9876543210", "Charged twice for same recharge", 199.0, "open", created);
    run(db, "INSERT INTO disputes VALUES (?,?,?,?,?,?)", "D-100002", "9123456780", "Data deducted without usage", 50.0, "open", created);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// `npm run seed` runs this file directly; importing it (tests, the server) must not seed anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDb();
  seed(db);
  db.close();
  console.log("Seed data inserted.");
}
