import random
import uuid
from datetime import datetime, timedelta

from mock_api.db import get_connection, init_db


def seed():
    init_db()
    conn = get_connection()
    cur = conn.cursor()

    plans = [
        ("PLAN_199", "Basic 199", 199.0, 28, 1.5, 1000, 100),
        ("PLAN_599", "Premium 599", 599.0, 56, 2.5, 3000, 100),
        ("PLAN_99", "Data Topup 99", 99.0, 30, 1.0, 0, 0),
    ]
    cur.executemany("INSERT OR REPLACE INTO plans VALUES (?,?,?,?,?,?,?)", plans)

    subscribers = [
        ("9876543210", "PLAN_199", 45.50, "active", "2026-09-10"),
        ("9123456780", "PLAN_599", 120.00, "active", "2026-09-05"),
        ("9988776655", "PLAN_199", 5.00, "barred", "2026-08-20"),
    ]
    cur.executemany("INSERT OR REPLACE INTO subscribers VALUES (?,?,?,?,?)", subscribers)

    # Re-seeding resets the mutable tables so the script is idempotent.
    cur.execute("DELETE FROM cdrs")
    cur.execute("DELETE FROM disputes")
    cur.execute("DELETE FROM transactions")

    for msisdn, *_ in subscribers:
        for _ in range(10):
            cur.execute(
                "INSERT INTO cdrs VALUES (?,?,?,?,?,?,?)",
                (
                    str(uuid.uuid4())[:8],
                    msisdn,
                    random.choice(["voice", "sms", "data"]),
                    random.randint(10, 600),
                    round(random.uniform(1, 500), 2),
                    round(random.uniform(0.5, 5), 2),
                    (datetime.now() - timedelta(days=random.randint(0, 20))).isoformat(),
                ),
            )

    now = datetime.now().isoformat()
    disputes = [
        ("D-100001", "9876543210", "Charged twice for same recharge", 199.0, "open", now),
        ("D-100002", "9123456780", "Data deducted without usage", 50.0, "open", now),
    ]
    cur.executemany("INSERT INTO disputes VALUES (?,?,?,?,?,?)", disputes)

    conn.commit()
    conn.close()
    print("Seed data inserted.")


if __name__ == "__main__":
    seed()
