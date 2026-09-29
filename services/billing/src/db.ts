import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

// services/billing/src -> repo root is three levels up. Same default file as the Python mock API, so either
// implementation can serve the same data (never run both against one file at the same time).
export const DEFAULT_DB_PATH = path.resolve(import.meta.dirname, "../../../data/billing.db");

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS subscribers (
    msisdn TEXT PRIMARY KEY,
    plan_id TEXT,
    balance REAL NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'active',
    last_recharge_date TEXT
);
CREATE TABLE IF NOT EXISTS plans (
    plan_id TEXT PRIMARY KEY,
    name TEXT,
    price REAL,
    validity_days INTEGER,
    data_per_day_gb REAL,
    voice_minutes INTEGER,
    sms_per_day INTEGER
);
CREATE TABLE IF NOT EXISTS cdrs (
    cdr_id TEXT PRIMARY KEY,
    msisdn TEXT,
    call_type TEXT,
    duration_sec INTEGER,
    data_mb REAL,
    charge REAL,
    timestamp TEXT,
    FOREIGN KEY (msisdn) REFERENCES subscribers(msisdn)
);
CREATE TABLE IF NOT EXISTS disputes (
    dispute_id TEXT PRIMARY KEY,
    msisdn TEXT,
    reason TEXT,
    amount_disputed REAL,
    status TEXT DEFAULT 'open',
    created_at TEXT,
    FOREIGN KEY (msisdn) REFERENCES subscribers(msisdn)
);
CREATE TABLE IF NOT EXISTS transactions (
    txn_id TEXT PRIMARY KEY,
    msisdn TEXT,
    type TEXT,
    amount REAL,
    balance_after REAL,
    timestamp TEXT
);
CREATE TABLE IF NOT EXISTS customer_tags (
    msisdn TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (msisdn, tag),
    FOREIGN KEY (msisdn) REFERENCES subscribers(msisdn)
);
CREATE TABLE IF NOT EXISTS notes (
    note_id TEXT PRIMARY KEY,
    msisdn TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_role TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (msisdn) REFERENCES subscribers(msisdn)
);
`;

export function openDb(file: string = process.env.BILLING_DB_PATH ?? DEFAULT_DB_PATH): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000"); // wait, instead of failing, if another process holds the file briefly
  db.exec(SCHEMA);
  return db;
}

/** Typed helpers over prepared statements. Row shapes are asserted by the caller: SQLite does not check them. */
export function all<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function get<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

export function run(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): void {
  db.prepare(sql).run(...params);
}

/** Run `work` in a transaction: commit if it returns, roll back if it throws. */
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
