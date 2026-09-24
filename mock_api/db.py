import os
import sqlite3

DEFAULT_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "billing.db")

SCHEMA = """
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
"""


def get_db_path() -> str:
    # Read at call time so tests can point at a temp DB via BILLING_DB_PATH.
    return os.environ.get("BILLING_DB_PATH", DEFAULT_DB_PATH)


def get_connection():
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_connection()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
    print(f"DB initialized at {get_db_path()}")
