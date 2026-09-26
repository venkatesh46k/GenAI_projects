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


def _last_ten_digits(number: str) -> str:
    return re.sub(r"\D", "", number)[-10:]


def numbers_in(text: str) -> list[str]:
    """Phone numbers written in `text`, in any of the formats MSISDN_PATTERN understands."""
    return [m.group(0) for m in MSISDN_PATTERN.finditer(text or "")]


def mask_pii(text: str, labels=REPLY_LABELS, keep_msisdns=()) -> str:
    """Replace personal identifiers with [MASKED_...] placeholders.

    `keep_msisdns` are numbers the *user themselves* supplied (typed in the question, or the customer selected in the
    console). Repeating those back reveals nothing they don't already have, and masking them makes replies read as
    broken ("no subscriber with number [MASKED_MSISDN]"). Any other number, e.g. one the assistant pulled from data, is
    still masked. Numbers match on their last 10 digits, so "+91 98765 43210" and "9876543210" are the same number.
    """
    keep = {_last_ten_digits(n) for n in keep_msisdns if n}
    for label in labels:
        if label == "msisdn" and keep:
            text = PII_PATTERNS[label].sub(
                lambda m: m.group(0) if _last_ten_digits(m.group(0)) in keep else "[MASKED_MSISDN]", text
            )
        else:
            text = PII_PATTERNS[label].sub(f"[MASKED_{label.upper()}]", text)
    return text
