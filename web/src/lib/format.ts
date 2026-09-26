import type { CdrItem } from "@contract/schemas";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });

/** ₹1,23,456.50 (Indian digit grouping). */
export const money = (value: number): string => inr.format(value);

const dateTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
// Date-only values such as "2026-09-10" are calendar dates, not instants: format them in UTC so a viewer west of
// Greenwich does not see the day before.
const dateOnly = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

/** "26 Sep 2026, 12:41 am" for a timestamp, "10 Sep 2026" for a bare date, "-" for nothing. */
export function formatWhen(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return value.includes("T") ? dateTime.format(parsed) : dateOnly.format(parsed);
}

export function formatUsage(cdr: Pick<CdrItem, "call_type" | "duration_sec" | "data_mb">): string {
  if (cdr.call_type === "voice") {
    const seconds = cdr.duration_sec ?? 0;
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  }
  if (cdr.call_type === "data") return `${(cdr.data_mb ?? 0).toFixed(1)} MB`;
  return "1 SMS";
}

export const STATUS_TONE = { active: "success", barred: "danger", expired: "warning" } as const;

export function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Barring threshold from the low-balance policy: below this, out-of-bundle usage is barred. */
export const LOW_BALANCE = 5;
