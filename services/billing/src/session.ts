import { ROLES, type SessionUser } from "./schemas.js";

export const COOKIE_NAME = "session";
export const DEFAULT_TTL_SECONDS = 8 * 60 * 60;

interface Payload extends SessionUser {
  /** Expiry, seconds since the epoch. Checked on every request, so a stolen cookie stops working on its own. */
  exp: number;
}

export function encodeSession(user: SessionUser, ttlSeconds: number, now = Date.now()): string {
  const payload: Payload = { name: user.name, role: user.role, exp: Math.floor(now / 1000) + ttlSeconds };
  return JSON.stringify(payload);
}

/** The user in a (already signature-checked) cookie value, or null if it is malformed or expired. */
export function decodeSession(raw: string, now = Date.now()): SessionUser | null {
  try {
    const value = JSON.parse(raw) as Partial<Payload>;
    if (typeof value.name !== "string" || !ROLES.includes(value.role as never)) return null;
    if (typeof value.exp !== "number" || value.exp * 1000 <= now) return null;
    return { name: value.name, role: value.role as SessionUser["role"] };
  } catch {
    return null;
  }
}
