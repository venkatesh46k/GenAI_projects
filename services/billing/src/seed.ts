import { randomInt, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { openDb, run } from "./db.js";

const PLANS = [
  ["PLAN_199", "Basic 199", 199.0, 28, 1.5, 1000, 100],
  ["PLAN_599", "Premium 599", 599.0, 56, 2.5, 3000, 100],
  ["PLAN_99", "Data Topup 99", 99.0, 30, 1.0, 0, 0],
] as const;

// The 3 hand-picked subscribers the test suites (and the earlier screenshots) know by exact number, balance and
// status. Never change these without checking services/billing/test/*.test.ts: several tests assert their exact
// values, and no transactions are ever seeded for them, only for the generated customers below.
const SUBSCRIBERS = [
  ["9876543210", "PLAN_199", 45.5, "active", "2026-09-10"],
  ["9123456780", "PLAN_599", 120.0, "active", "2026-09-05"],
  ["9988776655", "PLAN_199", 5.0, "barred", "2026-08-20"],
] as const;

// A larger, generated dataset so the console (lists, filters, the dashboard, reports) has something to show. These
// numbers all start with 70, a range the 3 hand-picked numbers above never touch, so a text search or a substring
// never accidentally crosses between "the 3 known fixtures" and "the generated crowd".
const GENERATED_COUNT = 50;
const FIRST_NAMES = [
  "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna", "Ishaan", "Rohan",
  "Ananya", "Diya", "Saanvi", "Aadhya", "Myra", "Pari", "Anika", "Navya", "Kiara", "Riya",
  "Rahul", "Amit", "Neha", "Pooja", "Vikram", "Sneha", "Karan", "Priya", "Manish", "Divya",
];
const LAST_NAMES = [
  "Sharma", "Verma", "Gupta", "Iyer", "Nair", "Reddy", "Rao", "Patel", "Singh", "Mehta",
  "Kumar", "Das", "Chatterjee", "Bose", "Pillai", "Menon", "Joshi", "Desai", "Kapoor", "Malhotra",
];
const CITIES = ["Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Pune", "Kolkata", "Ahmedabad", "Jaipur", "Lucknow"];
const STATUS_FOR = (i: number): "active" | "barred" | "expired" => (i % 10 === 0 ? "barred" : i % 13 === 0 ? "expired" : "active");

function generatedSubscriber(i: number): readonly [string, string, number, string, string] {
  const msisdn = `70${String(i).padStart(8, "0")}`;
  const plan = PLANS[i % PLANS.length]![0];
  const status = STATUS_FOR(i);
  const balance = status === "barred" ? between(0, 4.99) : between(0, 350);
  const lastRecharge = new Date(Date.now() - randomInt(0, 60) * 86_400_000).toISOString().slice(0, 10);
  return [msisdn, plan, balance, status, lastRecharge] as const;
}

function profileFor(i: number): { msisdn: string; name: string; email: string; city: string; segment: "Individual" | "Business" } {
  const first = FIRST_NAMES[i % FIRST_NAMES.length]!;
  const last = LAST_NAMES[(i * 7) % LAST_NAMES.length]!;
  return {
    msisdn: `70${String(i).padStart(8, "0")}`,
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.test`,
    city: CITIES[(i * 3) % CITIES.length]!,
    segment: i % 6 === 0 ? "Business" : "Individual",
  };
}

const CALL_TYPES = ["voice", "sms", "data"] as const;
const round2 = (value: number) => Math.round(value * 100) / 100;
const between = (low: number, high: number) => round2(low + Math.random() * (high - low));
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** Reset the demo data. Idempotent: mutable tables are cleared, so re-seeding always returns to the same shape
 * (exact values in the generated crowd vary run to run, the same as the original 3 subscribers' usage always did). */
export function seed(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const plan of PLANS) run(db, "INSERT OR REPLACE INTO plans VALUES (?,?,?,?,?,?,?)", ...plan);
    for (const sub of SUBSCRIBERS) run(db, "INSERT OR REPLACE INTO subscribers VALUES (?,?,?,?,?)", ...sub);
    run(db, "DELETE FROM cdrs");
    run(db, "DELETE FROM disputes");
    run(db, "DELETE FROM transactions");
    run(db, "DELETE FROM customer_tags");
    run(db, "DELETE FROM notes");
    run(db, "DELETE FROM customer_profiles");
    run(db, "DELETE FROM audit_log");

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

    // ---- the generated crowd: 50 more customers, with profiles, usage, transactions, disputes and a few tags ----
    const generated = Array.from({ length: GENERATED_COUNT }, (_, i) => generatedSubscriber(i + 1));
    for (const sub of generated) run(db, "INSERT OR REPLACE INTO subscribers VALUES (?,?,?,?,?)", ...sub);
    for (let i = 1; i <= GENERATED_COUNT; i++) {
      const p = profileFor(i);
      run(db, "INSERT INTO customer_profiles VALUES (?,?,?,?,?)", p.msisdn, p.name, p.email, p.city, p.segment);
    }

    for (const [msisdn] of generated) {
      const usageCount = randomInt(3, 16);
      for (let i = 0; i < usageCount; i++) {
        const when = new Date(now - randomInt(0, 60) * 86_400_000).toISOString();
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
      // A recharge history: most in the last 90 days, a few forced onto "today" so the dashboard is never empty.
      const rechargeCount = randomInt(1, 5);
      for (let i = 0; i < rechargeCount; i++) {
        const daysBack = i === 0 && msisdn.endsWith("1") ? 0 : randomInt(0, 90);
        const amount = [99, 199, 599][randomInt(0, 3)]!;
        run(
          db,
          "INSERT INTO transactions VALUES (?,?,?,?,?,?)",
          `TXN-${randomUUID().slice(0, 8)}`,
          msisdn,
          "recharge",
          amount,
          between(amount, amount + 300),
          daysAgo(daysBack),
        );
      }
    }

    // A dozen more disputes across the generated crowd, spread over the SLA window so the workspace shows a mix of
    // fine, nearly-overdue and overdue items, and every status the console can display.
    const DISPUTE_PLAN: Array<{ status: string; ageDays: number }> = [
      { status: "open", ageDays: 1 }, { status: "open", ageDays: 4 }, { status: "open", ageDays: 8 }, { status: "open", ageDays: 11 },
      { status: "escalated", ageDays: 2 }, { status: "escalated", ageDays: 6 }, { status: "escalated", ageDays: 9 },
      { status: "resolved", ageDays: 15 }, { status: "resolved", ageDays: 20 }, { status: "resolved", ageDays: 30 },
      { status: "rejected", ageDays: 18 }, { status: "rejected", ageDays: 25 },
    ];
    const REASONS = [
      "Charged for a plan I did not activate", "Data deducted without usage", "Recharge not reflected in balance",
      "Duplicate deduction for the same recharge", "SMS pack charged twice", "Roaming charge disputed",
    ];
    DISPUTE_PLAN.forEach((d, i) => {
      const sub = generated[i % generated.length]!;
      run(
        db,
        "INSERT INTO disputes VALUES (?,?,?,?,?,?)",
        `D-2000${String(i + 1).padStart(2, "0")}`,
        sub[0],
        REASONS[i % REASONS.length]!,
        between(20, 400),
        d.status,
        daysAgo(d.ageDays),
      );
    });

    // A handful of tags, so the filter menu and the list are not empty on a first look.
    const vip = [generated[2]![0], generated[9]![0], generated[16]![0], generated[23]![0], generated[30]![0]];
    const atRisk = [generated[5]![0], generated[15]![0], generated[35]![0]];
    for (const msisdn of vip) run(db, "INSERT INTO customer_tags (msisdn, tag, created_at) VALUES (?,?,?)", msisdn, "VIP", created);
    for (const msisdn of atRisk) run(db, "INSERT INTO customer_tags (msisdn, tag, created_at) VALUES (?,?,?)", msisdn, "At risk", created);

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
