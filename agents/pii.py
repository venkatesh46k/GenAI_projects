import re

# The spec's plain \b\d{10}\b misses common real-world formats such as +919876543210,
# +91 98765 43210 and 98765-43210. This matches an optional +91/91 prefix and a 10-digit number
# written as one block or two blocks of five. The lookarounds keep it from matching inside
# longer digit runs (e.g. 12-digit reference numbers).
MSISDN_PATTERN = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?\d{5}[\s-]?\d{5}(?!\d)")

PII_PATTERNS = {
    "msisdn": MSISDN_PATTERN,
    "dispute_id": re.compile(r"\bD-\w{6,}\b"),
    "txn_id": re.compile(r"\bTXN-\w{6,}\b"),
}

# Customer-facing replies keep dispute IDs: the customer needs that reference to follow up on their
# own dispute, and it is not personal data. Logs mask everything.
REPLY_LABELS = ("msisdn", "txn_id")
ALL_LABELS = tuple(PII_PATTERNS)


def mask_pii(text: str, labels=REPLY_LABELS) -> str:
    for label in labels:
        text = PII_PATTERNS[label].sub(f"[MASKED_{label.upper()}]", text)
    return text
