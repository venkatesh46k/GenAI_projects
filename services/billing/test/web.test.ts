import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { seed } from "../src/seed.js";
import { encodeSession } from "../src/session.js";
import { buildWebApp, type WebConfig } from "../src/web.js";

const SECRET = "web-test-secret-".repeat(3);
const MSISDN = "9876543210";
const LOGIN = { name: "Priya Sharma", role: "team_lead" };

let app: FastifyInstance | undefined;

function build(config: Partial<WebConfig> = {}) {
  const db = openDb(":memory:");
  seed(db);
  app = buildWebApp(db, {}, { sessionSecret: SECRET, staticDir: "/nonexistent", ...config });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A second server with a different secret: what an attacker who does not know ours can sign. */
async function forgeWith(secret: string): Promise<FastifyInstance> {
  const attacker = buildWebApp(openDb(":memory:"), {}, { sessionSecret: secret, staticDir: "/nonexistent" });
  await attacker.ready();
  return attacker;
}

/** Sign in and return the Cookie header value to send on later requests. */
async function signIn(a: FastifyInstance, body: unknown = LOGIN): Promise<string> {
  const res = await a.inject({ method: "POST", url: "/api/session", payload: body as never });
  expect(res.statusCode).toBe(200);
  return `session=${res.cookies[0]!.value}`;
}

describe("sign-in", () => {
  it("creates a signed, httpOnly, same-site session and returns the user", async () => {
    const a = build();
    const res = await a.inject({ method: "POST", url: "/api/session", payload: LOGIN });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(LOGIN);
    const header = String(res.headers["set-cookie"]);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Path=\//);
    expect(header).not.toMatch(/;\s*Secure/i); // plain http in development
    expect(res.cookies[0]!.value).toContain("."); // a signature follows the value
  });

  it("marks the cookie Secure and sends HSTS when served over https", async () => {
    const a = build({ cookieSecure: true });
    const res = await a.inject({ method: "POST", url: "/api/session", payload: LOGIN });
    expect(String(res.headers["set-cookie"])).toMatch(/Secure/i);
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });

  it("reports who is signed in, and signs out", async () => {
    const a = build();
    const cookie = await signIn(a);
    expect((await a.inject({ method: "GET", url: "/api/session", headers: { cookie } })).json()).toEqual(LOGIN);

    const out = await a.inject({ method: "DELETE", url: "/api/session", headers: { cookie } });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers["set-cookie"])).toMatch(/session=;/); // the browser is told to drop it
  });

  it.each([
    ["digits in the name", { name: "Agent 007", role: "agent" }],
    ["markup in the name", { name: "<script>alert(1)</script>", role: "agent" }],
    ["a one-letter name", { name: "A", role: "agent" }],
    ["a very long name", { name: "A".repeat(41), role: "agent" }],
    ["a control character", { name: "Priya\nSharma", role: "agent" }],
    ["an unknown role", { name: "Priya Sharma", role: "admin" }],
    ["a missing role", { name: "Priya Sharma" }],
    ["an extra field", { name: "Priya Sharma", role: "agent", isAdmin: true }],
  ])("refuses a sign-in with %s", async (_label, body) => {
    const res = await build().inject({ method: "POST", url: "/api/session", payload: body });
    expect(res.statusCode).toBe(422);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("accepts real-world names: accents, apostrophes, hyphens, dots", async () => {
    const a = build();
    for (const name of ["José Álvarez", "Siobhan O'Neil", "Anne-Marie", "K. R. Nair"]) {
      expect((await a.inject({ method: "POST", url: "/api/session", payload: { name, role: "agent" } })).statusCode).toBe(200);
    }
  });

  it("slows down repeated sign-in attempts", async () => {
    const a = build({ loginRateLimitPerMinute: 3 });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await a.inject({ method: "POST", url: "/api/session", payload: LOGIN })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });
});

describe("who may call what", () => {
  const PROTECTED: Array<[string, string]> = [
    ["GET", "/api/session"],
    ["GET", "/api/customers"],
    ["GET", `/api/customers/${MSISDN}/overview`],
    ["POST", `/api/customers/${MSISDN}/recharge`],
    ["GET", "/api/plans"],
    ["POST", "/api/disputes/D-100001/escalate"],
    ["GET", "/api/disputes"],
    ["GET", "/api/dashboard"],
    ["GET", "/api/tags"],
    ["POST", `/api/customers/${MSISDN}/notes`],
    ["POST", `/api/customers/${MSISDN}/tags`],
    ["POST", "/api/chat"],
    ["POST", "/api/chat/stream"],
    ["GET", "/api/evidence/a.png"],
  ];

  it.each(PROTECTED)("%s %s needs a session", async (method, url) => {
    const res = await build().inject({ method: method as "GET", url, payload: method === "POST" ? {} : undefined });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ detail: "Sign in required" });
  });

  it("leaves only sign-in and health public", async () => {
    const a = build();
    expect((await a.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await a.inject({ method: "POST", url: "/api/session", payload: LOGIN })).statusCode).toBe(200);
  });

  it("refuses a cookie whose value was tampered with", async () => {
    const a = build();
    const cookie = await signIn(a);
    const forged = cookie.replace(/^session=[^.]*/, `session=${encodeURIComponent(encodeSession({ name: "Boss", role: "team_lead" }, 3600))}`);
    expect((await a.inject({ method: "GET", url: "/api/customers", headers: { cookie: forged } })).statusCode).toBe(401);
  });

  it("refuses a cookie signed with a different secret", async () => {
    const a = build();
    const attacker = await forgeWith("a-completely-different-secret-value-!");
    const foreign = `session=${encodeURIComponent(attacker.signCookie(encodeSession(LOGIN as never, 3600)))}`;
    expect((await a.inject({ method: "GET", url: "/api/customers", headers: { cookie: foreign } })).statusCode).toBe(401);
    await attacker.close();
  });

  it("refuses an expired session even though the signature is valid", async () => {
    const a = build();
    await a.ready();
    const expired = `session=${encodeURIComponent(a.signCookie(encodeSession(LOGIN as never, -60)))}`;
    expect((await a.inject({ method: "GET", url: "/api/customers", headers: { cookie: expired } })).statusCode).toBe(401);
  });

  it("refuses a validly signed session with an invalid role", async () => {
    const a = build();
    await a.ready();
    const bad = `session=${encodeURIComponent(a.signCookie(JSON.stringify({ name: "Eve", role: "root", exp: Math.floor(Date.now() / 1000) + 600 })))}`;
    expect((await a.inject({ method: "GET", url: "/api/customers", headers: { cookie: bad } })).statusCode).toBe(401);
  });

  it("refuses state-changing requests that come from another site, even with a valid cookie", async () => {
    const a = build();
    const cookie = await signIn(a);
    const attack = await a.inject({
      method: "POST",
      url: `/api/customers/${MSISDN}/recharge`,
      headers: { cookie, origin: "http://evil.example", host: "billing.example.com" },
      payload: { amount: 500 },
    });
    expect(attack.statusCode).toBe(403);
    const balance = await a.inject({ method: "GET", url: `/api/customers/${MSISDN}/overview`, headers: { cookie } });
    expect(balance.json().subscriber.balance).toBe(45.5); // nothing was charged

    const legitimate = await a.inject({
      method: "POST",
      url: `/api/customers/${MSISDN}/recharge`,
      headers: { cookie, origin: "http://billing.example.com", host: "billing.example.com" },
      payload: { amount: 500 },
    });
    expect(legitimate.statusCode).toBe(200);
  });

  it("does not expose the internal billing routes", async () => {
    const a = build();
    const cookie = await signIn(a);
    for (const url of ["/balance/9876543210", "/subscribers", "/cdr/9876543210", "/dispute/D-100001"]) {
      expect((await a.inject({ method: "GET", url, headers: { cookie } })).statusCode).toBe(404);
    }
  });
});

describe("customer screens", () => {
  const authed = async () => {
    const a = build();
    return { a, headers: { cookie: await signIn(a) } };
  };

  it("lists customers, filters by number text and by status", async () => {
    const { a, headers } = await authed();
    const all = (await a.inject({ method: "GET", url: "/api/customers", headers })).json();
    // 3 hand-picked fixtures plus the generated crowd from seed.ts (GENERATED_COUNT = 50).
    expect(all).toHaveLength(53);
    expect(all.map((c: { msisdn: string }) => c.msisdn)).toEqual(expect.arrayContaining(["9123456780", "9876543210", "9988776655"]));
    const q = (await a.inject({ method: "GET", url: "/api/customers?q=9876", headers })).json();
    expect(q.map((c: { msisdn: string }) => c.msisdn)).toEqual([MSISDN]);
    const barred = (await a.inject({ method: "GET", url: "/api/customers?status=barred", headers })).json();
    // the 1 hand-picked barred fixture, plus every 10th generated customer (seed.ts's STATUS_FOR)
    expect(barred).toHaveLength(6);
    expect(barred.map((c: { msisdn: string }) => c.msisdn)).toEqual(expect.arrayContaining(["9988776655"]));
  });

  it("treats % and _ in the search box as plain text, not wildcards", async () => {
    const { a, headers } = await authed();
    for (const q of ["%", "_", "9_7", "%3210"]) {
      const rows = (await a.inject({ method: "GET", url: `/api/customers?q=${encodeURIComponent(q)}`, headers })).json();
      expect(rows).toEqual([]);
    }
  });

  it("rejects an unknown status filter and an oversized search", async () => {
    const { a, headers } = await authed();
    expect((await a.inject({ method: "GET", url: "/api/customers?status=vip", headers })).statusCode).toBe(422);
    expect((await a.inject({ method: "GET", url: `/api/customers?q=${"9".repeat(41)}`, headers })).statusCode).toBe(422); // longer than the max (a phone number or a name)
  });

  it("returns everything the Customer 360 screen needs in one call", async () => {
    const { a, headers } = await authed();
    const overview = (await a.inject({ method: "GET", url: `/api/customers/${MSISDN}/overview`, headers })).json();
    expect(Object.keys(overview).sort()).toEqual(["disputes", "notes", "plan", "profile", "subscriber", "tags", "transactions", "usage"]);
    expect(overview.subscriber).toMatchObject({ msisdn: MSISDN, balance: 45.5, status: "active" });
    expect(overview.profile).toBeNull(); // no profile is seeded for the 3 hand-picked fixtures
    expect(overview.plan).toMatchObject({ plan_id: "PLAN_199", name: "Basic 199" });
    expect(overview.usage).toHaveLength(10);
    expect(overview.disputes.map((d: { dispute_id: string }) => d.dispute_id)).toEqual(["D-100001"]);
    expect(overview.notes).toEqual([]);
    expect(overview.tags).toEqual([]);
  });

  it("404s for an unknown customer", async () => {
    const { a, headers } = await authed();
    expect((await a.inject({ method: "GET", url: "/api/customers/0000000000/overview", headers })).statusCode).toBe(404);
  });

  it("recharges the customer named in the URL, and shows it on the next overview", async () => {
    const { a, headers } = await authed();
    const res = await a.inject({ method: "POST", url: `/api/customers/${MSISDN}/recharge`, headers, payload: { amount: 199, plan_id: "PLAN_599" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().new_balance).toBe(244.5);
    const overview = (await a.inject({ method: "GET", url: `/api/customers/${MSISDN}/overview`, headers })).json();
    expect(overview.subscriber.balance).toBe(244.5);
    expect(overview.plan.plan_id).toBe("PLAN_599");
    expect(overview.transactions).toHaveLength(1);
  });

  it.each([
    ["a number in the body (the URL is the authority)", { amount: 10, msisdn: "9123456780" }],
    ["a zero amount", { amount: 0 }],
    ["a negative amount", { amount: -5 }],
    ["a text amount", { amount: "ten" }],
    ["no amount", {}],
  ])("refuses a recharge with %s", async (_label, payload) => {
    const { a, headers } = await authed();
    expect((await a.inject({ method: "POST", url: `/api/customers/${MSISDN}/recharge`, headers, payload })).statusCode).toBe(422);
    const overview = (await a.inject({ method: "GET", url: `/api/customers/${MSISDN}/overview`, headers })).json();
    expect(overview.subscriber.balance).toBe(45.5);
  });

  it("404s a recharge for an unknown customer", async () => {
    const { a, headers } = await authed();
    expect((await a.inject({ method: "POST", url: "/api/customers/0000000000/recharge", headers, payload: { amount: 10 } })).statusCode).toBe(404);
  });

  it("lists plans cheapest first", async () => {
    const { a, headers } = await authed();
    const plans = (await a.inject({ method: "GET", url: "/api/plans", headers })).json();
    expect(plans.map((p: { plan_id: string }) => p.plan_id)).toEqual(["PLAN_99", "PLAN_199", "PLAN_599"]);
  });

  it("escalates a dispute and 404s an unknown one", async () => {
    const { a, headers } = await authed();
    const ok = await a.inject({ method: "POST", url: "/api/disputes/D-100001/escalate", headers });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ dispute_id: "D-100001", status: "escalated" });
    expect((await a.inject({ method: "POST", url: "/api/disputes/D-nope/escalate", headers })).statusCode).toBe(404);
  });
});

describe("tags", () => {
  const authed = async (role: "agent" | "team_lead" = "agent") => {
    const a = build();
    return { a, headers: { cookie: await signIn(a, { name: "Priya", role }) } };
  };

  it("adds and removes a tag, and lists it back on the customer and the all-tags menu", async () => {
    const { a, headers } = await authed();
    // a tag name the seed data never uses, so this test's exact-match assertions do not depend on seed.ts's choices
    const added = await a.inject({ method: "POST", url: `/api/customers/${MSISDN}/tags`, headers, payload: { tag: "QA-Only-Tag" } });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toEqual({ tags: ["QA-Only-Tag"] });

    const overview = (await a.inject({ method: "GET", url: `/api/customers/${MSISDN}/overview`, headers })).json();
    expect(overview.tags).toEqual(["QA-Only-Tag"]);
    expect((await a.inject({ method: "GET", url: "/api/tags", headers })).json()).toContain("QA-Only-Tag");

    const list = (await a.inject({ method: "GET", url: `/api/customers?tag=QA-Only-Tag`, headers })).json();
    expect(list.map((c: { msisdn: string }) => c.msisdn)).toEqual([MSISDN]);

    const removed = await a.inject({ method: "DELETE", url: `/api/customers/${MSISDN}/tags/${encodeURIComponent("QA-Only-Tag")}`, headers });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ tags: [] });
  });

  it("adding the same tag twice is not an error and does not duplicate it", async () => {
    const { a, headers } = await authed();
    await a.inject({ method: "POST", url: `/api/customers/${MSISDN}/tags`, headers, payload: { tag: "At risk" } });
    const again = await a.inject({ method: "POST", url: `/api/customers/${MSISDN}/tags`, headers, payload: { tag: "At risk" } });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ tags: ["At risk"] });
  });

  it("404s a tag on an unknown customer and rejects an unreasonable tag", async () => {
    const { a, headers } = await authed();
    expect((await a.inject({ method: "POST", url: "/api/customers/0000000000/tags", headers, payload: { tag: "VIP" } })).statusCode).toBe(404);
    for (const tag of ["", "x".repeat(25), "<script>"]) {
      expect((await a.inject({ method: "POST", url: `/api/customers/${MSISDN}/tags`, headers, payload: { tag } })).statusCode, tag).toBe(422);
    }
  });
});

describe("notes", () => {
  const authed = async () => {
    const a = build();
    return { a, headers: { cookie: await signIn(a, { name: "Priya Sharma", role: "agent" }) } };
  };

  it("adds a note, attributed to whoever is signed in, and it shows up on the overview", async () => {
    const { a, headers } = await authed();
    const res = await a.inject({ method: "POST", url: `/api/customers/${MSISDN}/notes`, headers, payload: { text: "Asked for a plan upgrade." } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ msisdn: MSISDN, author_name: "Priya Sharma", author_role: "agent", text: "Asked for a plan upgrade." });
    expect(res.json().note_id).toMatch(/^N-[0-9a-f]{8}$/);

    const overview = (await a.inject({ method: "GET", url: `/api/customers/${MSISDN}/overview`, headers })).json();
    expect(overview.notes).toHaveLength(1);
    expect(overview.notes[0].text).toBe("Asked for a plan upgrade.");
  });

  it("404s a note on an unknown customer and rejects an empty one", async () => {
    const { a, headers } = await authed();
    expect((await a.inject({ method: "POST", url: "/api/customers/0000000000/notes", headers, payload: { text: "x" } })).statusCode).toBe(404);
    expect((await a.inject({ method: "POST", url: `/api/customers/${MSISDN}/notes`, headers, payload: { text: "" } })).statusCode).toBe(422);
    expect((await a.inject({ method: "POST", url: `/api/customers/${MSISDN}/notes`, headers, payload: {} })).statusCode).toBe(422);
  });
});

describe("dispute workspace and resolution", () => {
  const authed = async (role: "agent" | "team_lead") => {
    const a = build();
    return { a, headers: { cookie: await signIn(a, { name: "Someone", role }) } };
  };

  it("lists disputes across every customer, filterable by status", async () => {
    const { a, headers } = await authed("agent");
    const all = (await a.inject({ method: "GET", url: "/api/disputes", headers })).json();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.every((d: { msisdn: string }) => d.msisdn)).toBe(true); // the workspace needs to know whose dispute it is

    const open = (await a.inject({ method: "GET", url: "/api/disputes?status=open", headers })).json();
    expect(open.every((d: { status: string }) => d.status === "open")).toBe(true);

    const combined = (await a.inject({ method: "GET", url: `/api/disputes?status=open&msisdn=${MSISDN}`, headers })).json();
    expect(combined.every((d: { msisdn: string; status: string }) => d.msisdn === MSISDN && d.status === "open")).toBe(true);
  });

  it("an agent can view but not escalate or resolve a dispute", async () => {
    const { a, headers } = await authed("agent");
    const escalate = await a.inject({ method: "POST", url: "/api/disputes/D-100001/escalate", headers });
    expect(escalate.statusCode).toBe(403);
    expect(escalate.json()).toEqual({ detail: "Only a team lead can do this." });
    const resolve = await a.inject({ method: "POST", url: "/api/disputes/D-100001/resolve", headers, payload: { outcome: "resolved" } });
    expect(resolve.statusCode).toBe(403);
  });

  it("a team lead resolves or rejects a dispute, and 404s an unknown one", async () => {
    const { a, headers } = await authed("team_lead");
    const resolved = await a.inject({ method: "POST", url: "/api/disputes/D-100001/resolve", headers, payload: { outcome: "resolved" } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({ dispute_id: "D-100001", status: "resolved" });

    const rejected = await a.inject({ method: "POST", url: "/api/disputes/D-100002/resolve", headers, payload: { outcome: "rejected" } });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({ status: "rejected" });

    expect((await a.inject({ method: "POST", url: "/api/disputes/D-nope/resolve", headers, payload: { outcome: "resolved" } })).statusCode).toBe(404);
    expect((await a.inject({ method: "POST", url: "/api/disputes/D-100001/resolve", headers, payload: { outcome: "maybe" } })).statusCode).toBe(422);
  });
});

describe("dashboard", () => {
  it("reports cross-customer totals that move when a recharge happens", async () => {
    const a = build();
    const headers = { cookie: await signIn(a, { name: "Priya", role: "agent" }) };
    const before = (await a.inject({ method: "GET", url: "/api/dashboard", headers })).json();
    // 53 total (3 fixtures + 50 generated), 6 barred (1 fixture + 5 generated: see seed.ts's STATUS_FOR)
    expect(before).toMatchObject({ customer_count: 53, barred_count: 6 });
    expect(before.revenue_last_7_days).toHaveLength(7);
    expect(before.open_disputes).toBeGreaterThanOrEqual(1);

    await a.inject({ method: "POST", url: `/api/customers/${MSISDN}/recharge`, headers, payload: { amount: 199 } });
    const after = (await a.inject({ method: "GET", url: "/api/dashboard", headers })).json();
    expect(after.today_recharge_count).toBe(before.today_recharge_count + 1);
    expect(after.today_recharge_amount).toBeCloseTo(before.today_recharge_amount + 199, 5);
    expect(after.total_balance).toBeCloseTo(before.total_balance + 199, 5);
    const today = new Date().toISOString().slice(0, 10);
    expect(after.revenue_last_7_days.at(-1)).toMatchObject({ date: today });
  });
});

describe("security headers", () => {
  it("sets a strict content security policy and the usual hardening headers", async () => {
    const res = await build().inject({ method: "GET", url: "/api/health" });
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["strict-transport-security"]).toBeUndefined(); // not over https
  });
});

describe("hosting the React app", () => {
  function dist() {
    const dir = mkdtempSync(path.join(tmpdir(), "web-dist-"));
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Billing Ops</title><div id=root></div>");
    writeFileSync(path.join(dir, "assets", "app-abc123.js"), "console.log('app')");
    writeFileSync(path.join(path.dirname(dir), "outside-secret.txt"), "not for you");
    return dir;
  }

  it("serves the shell without caching and hashed assets forever", async () => {
    const a = build({ staticDir: dist() });
    const shell = await a.inject({ method: "GET", url: "/" });
    expect(shell.statusCode).toBe(200);
    expect(shell.body).toContain("Billing Ops");
    expect(shell.headers["cache-control"]).toBe("no-cache");
    const asset = await a.inject({ method: "GET", url: "/assets/app-abc123.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("lets the single-page app resolve its own routes on a hard refresh", async () => {
    const a = build({ staticDir: dist() });
    for (const url of ["/customers", `/customers/${MSISDN}`, "/login"]) {
      const res = await a.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("Billing Ops");
    }
  });

  it("answers a missing file with 404, not the app shell (a stale asset URL must not load HTML as a script)", async () => {
    const a = build({ staticDir: dist() });
    for (const url of ["/assets/app-old999.js", "/assets/app-old999.css?v=1", "/favicon.png"]) {
      const res = await a.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(404);
      expect(res.body).not.toContain("Billing Ops");
    }
  });

  it("still answers unknown API paths with JSON, not the app shell", async () => {
    const a = build({ staticDir: dist() });
    const cookie = await signIn(a);
    const res = await a.inject({ method: "GET", url: "/api/no-such-thing", headers: { cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ detail: "Not Found" });
    expect((await a.inject({ method: "POST", url: "/somewhere", payload: {} })).statusCode).toBe(404);
  });

  it("does not serve files outside the build folder", async () => {
    const a = build({ staticDir: dist() });
    for (const url of ["/assets/..%2f..%2foutside-secret.txt", "/..%2foutside-secret.txt", "/assets/%2e%2e/%2e%2e/outside-secret.txt"]) {
      const res = await a.inject({ method: "GET", url });
      expect(res.body).not.toContain("not for you");
    }
  });

  it("is API-only, with plain JSON 404s, when no front-end has been built", async () => {
    const res = await build({ staticDir: "/no/such/folder" }).inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ detail: "Not Found" });
  });
});
