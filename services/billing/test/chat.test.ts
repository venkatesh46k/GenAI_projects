import type { FastifyInstance } from "fastify";
import type { LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiConfig } from "../src/chat.js";
import { openDb } from "../src/db.js";
import { seed } from "../src/seed.js";
import { buildWebApp } from "../src/web.js";

const AI_RESPONSE = {
  answer: "15 days.",
  route: "rag",
  route_method: "llm",
  pii_masked: false,
  safety_flag: null,
  tool_calls: [],
  sources: ["passage"],
  dispute_id: null,
  ticket_id: null,
  test_result: null,
};

type FetchStub = ReturnType<typeof vi.fn>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let app: FastifyInstance | undefined;

const SECRET = "test-secret-".repeat(4);
const LOGIN = { name: "Test Agent", role: "agent" };

/** The public web server, with the AI service faked. Requests are signed in automatically (see `unauthenticated`). */
function build(fetchStub?: FetchStub, overrides: Partial<AiConfig> = {}) {
  const db = openDb(":memory:");
  seed(db);
  const a = buildWebApp(
    db,
    {},
    {
      sessionSecret: SECRET,
      staticDir: "/nonexistent",
      ai: fetchStub ? { url: "http://ai.internal:8100", timeoutMs: 5000, fetch: fetchStub as never, ...overrides } : undefined,
    },
  );
  const raw = a.inject.bind(a) as (opts: unknown) => Promise<LightMyRequestResponse>;
  let cookie: string | undefined;
  (a as unknown as { inject: unknown }).inject = async (opts: { headers?: Record<string, string> }) => {
    cookie ??= `session=${(await raw({ method: "POST", url: "/api/session", payload: LOGIN })).cookies[0]!.value}`;
    return raw({ ...opts, headers: { cookie, ...opts.headers } });
  };
  return a;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const chat = (a: FastifyInstance, payload: unknown) => a.inject({ method: "POST", url: "/api/chat", payload: payload as never });

/** An SSE body delivered in the given chunks, to prove events survive being split anywhere. */
function sseBody(chunks: string[], { failAfter }: { failAfter?: number } = {}) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (failAfter !== undefined && i === failAfter) return controller.error(new Error("upstream died"));
      if (i >= chunks.length) return controller.close();
      controller.enqueue(encoder.encode(chunks[i++]!));
    },
  });
}

describe("POST /api/chat", () => {
  it("forwards a validated request and returns the AI service's answer", async () => {
    const fetchStub = vi.fn(async () => json(AI_RESPONSE));
    const res = await chat(build(fetchStub), { query: "what is the grace period?", msisdn: "9876543210" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(AI_RESPONSE);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://ai.internal:8100/chat");
    expect(JSON.parse(init.body as string)).toEqual({ query: "what is the grace period?", msisdn: "9876543210" });
  });

  it("sends the internal token and the request id, so the call can be traced across services", async () => {
    const fetchStub = vi.fn(async () => json(AI_RESPONSE));
    const res = await build(fetchStub, { token: "s3cret" }).inject({
      method: "POST",
      url: "/api/chat",
      headers: { "x-request-id": "trace-42" },
      payload: { query: "hi" },
    });
    const headers = new Headers((fetchStub.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.get("x-internal-token")).toBe("s3cret");
    expect(headers.get("x-request-id")).toBe("trace-42");
    expect(res.headers["x-request-id"]).toBe("trace-42");
  });

  it("does not send a token header when none is configured", async () => {
    const fetchStub = vi.fn(async () => json(AI_RESPONSE));
    await chat(build(fetchStub), { query: "hi" });
    expect(new Headers((fetchStub.mock.calls[0] as unknown as [string, RequestInit])[1].headers).has("x-internal-token")).toBe(false);
  });

  it("points screenshot URLs at this tier, the only public entry point", async () => {
    const withTest = { ...AI_RESPONSE, test_result: { status: "pass", detail: "ok", evidence_url: "/evidence/a.png", steps_completed: 9 } };
    const res = await chat(build(vi.fn(async () => json(withTest))), { query: "verify" });
    expect(res.json().test_result.evidence_url).toBe("/api/evidence/a.png");
  });

  it.each([
    ["an empty question", { query: "" }],
    ["a missing question", {}],
    ["an oversized question", { query: "x".repeat(2001) }],
    ["a malformed number", { query: "hi", msisdn: "123" }],
    ["an unknown field", { query: "hi", role: "admin" }],
    ["a non-string question", { query: 42 }],
  ])("rejects %s with a 422 without calling the AI service", async (_label, payload) => {
    const fetchStub = vi.fn(async () => json(AI_RESPONSE));
    const res = await chat(build(fetchStub), payload);
    expect(res.statusCode).toBe(422);
    expect(Array.isArray(res.json().detail)).toBe(true);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("accepts a null number, the same as leaving it out", async () => {
    const fetchStub = vi.fn(async () => json(AI_RESPONSE));
    expect((await chat(build(fetchStub), { query: "hi", msisdn: null })).statusCode).toBe(200);
  });

  it("rejects an oversized body and an unsupported content type without touching the AI service", async () => {
    const fetchStub = vi.fn(async () => json(AI_RESPONSE));
    const a = build(fetchStub);
    const big = await a.inject({ method: "POST", url: "/api/chat", headers: { "content-type": "application/json" }, payload: JSON.stringify({ query: "x".repeat(70_000) }) });
    expect(big.statusCode).toBe(413);
    expect(big.json()).toEqual({ detail: "Request body too large" });
    // Plain text is parsed (Fastify has a built-in parser) and then fails validation: it is not a JSON object.
    const plain = await a.inject({ method: "POST", url: "/api/chat", headers: { "content-type": "text/plain" }, payload: "hi" });
    expect(plain.statusCode).toBe(422);
    // A type nothing can parse never reaches the handler.
    const xml = await a.inject({ method: "POST", url: "/api/chat", headers: { "content-type": "application/xml" }, payload: "<q>hi</q>" });
    expect(xml.statusCode).toBe(415);
    expect(xml.json()).toEqual({ detail: "Bad request" });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("chat failure handling: every failure is a safe, specific message", () => {
  it("answers 503 when the AI service is unreachable", async () => {
    const res = await chat(build(vi.fn(async () => Promise.reject(new TypeError("fetch failed: ECONNREFUSED 10.0.0.5")))), { query: "hi" });
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).toContain("unavailable");
    expect(res.body).not.toContain("10.0.0.5"); // internal addresses never reach the browser
  });

  it.each(["TimeoutError", "AbortError"])("answers 504 on a %s", async (name) => {
    const res = await chat(build(vi.fn(async () => Promise.reject(Object.assign(new Error("slow"), { name })))), { query: "hi" });
    expect(res.statusCode).toBe(504);
    expect(res.json().detail).toContain("too long");
  });

  it("passes a busy AI service on as 429", async () => {
    const res = await chat(build(vi.fn(async () => json({ detail: "busy" }, 429))), { query: "hi" });
    expect(res.statusCode).toBe(429);
    expect(res.json().detail).toContain("busy");
  });

  it.each([401, 403, 500, 502])("turns an upstream %s into a generic 502 that leaks nothing", async (status) => {
    const res = await chat(build(vi.fn(async () => json({ detail: "Invalid or missing internal token: secret-detail" }, status))), { query: "hi" });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain("secret-detail");
    expect(res.body).not.toContain("token");
  });

  it("answers 503 when no AI service is configured", async () => {
    const res = await chat(build(undefined), { query: "hi" });
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).toContain("not configured");
  });

  it("keeps the customer screens working while the assistant is down", async () => {
    const a = build(vi.fn(async () => Promise.reject(new Error("down"))));
    expect((await a.inject({ method: "GET", url: "/api/customers/9876543210/overview" })).statusCode).toBe(200);
  });

  it("does not expose the internal billing routes on the public server", async () => {
    const a = build(vi.fn(async () => json(AI_RESPONSE)));
    for (const [method, url] of [["GET", "/balance/9876543210"], ["GET", "/subscribers"], ["POST", "/recharge"], ["GET", "/cdr/9876543210"]] as const) {
      expect((await a.inject({ method, url, payload: method === "POST" ? { msisdn: "9876543210", amount: 500 } : undefined })).statusCode).toBe(404);
    }
  });
});

describe("POST /api/chat/stream", () => {
  const EVENTS = [
    'event: step\ndata: {"node":"router","message":"Routed to rag (llm)"}\n\n',
    ": keepalive\n\n",
    `event: result\ndata: ${JSON.stringify({ ...AI_RESPONSE, test_result: { status: "pass", detail: "ok", evidence_url: "/evidence/a.png" } })}\n\n`,
    "event: done\ndata: {}\n\n",
  ].join("");

  const streamFetch = (chunks: string[], opts?: { failAfter?: number }) =>
    vi.fn(async () => new Response(sseBody(chunks, opts), { status: 200, headers: { "content-type": "text/event-stream" } }));

  it("relays the events and points screenshots at this tier", async () => {
    const res = await build(streamFetch([EVENTS])).inject({ method: "POST", url: "/api/chat/stream", payload: { query: "verify" } });
    expect(res.statusCode).toBe(200);
    // The charset is explicit: a client that guesses (Python requests assumes Latin-1) would garble U+202F and similar.
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.body).toContain('event: step\ndata: {"node":"router","message":"Routed to rag (llm)"}');
    expect(res.body).toContain(": keepalive");
    expect(res.body).toContain('"evidence_url":"/api/evidence/a.png"');
    expect(res.body).not.toContain('"evidence_url":"/evidence/');
    expect(res.body.trimEnd().endsWith("event: done\ndata: {}")).toBe(true);
  });

  it("keeps events intact when the network splits them anywhere", async () => {
    const chunks = EVENTS.match(/[\s\S]{1,7}/g) as string[]; // 7-byte pieces: splits inside words and inside \n\n
    const res = await build(streamFetch(chunks)).inject({ method: "POST", url: "/api/chat/stream", payload: { query: "verify" } });
    const whole = await build(streamFetch([EVENTS])).inject({ method: "POST", url: "/api/chat/stream", payload: { query: "verify" } });
    expect(res.body).toBe(whole.body);
  });

  it("ends with a safe error event when the AI service dies mid-answer", async () => {
    const res = await build(streamFetch([EVENTS.slice(0, 60), EVENTS.slice(60)], { failAfter: 1 })).inject({
      method: "POST",
      url: "/api/chat/stream",
      payload: { query: "hi" },
    });
    expect(res.statusCode).toBe(200); // headers were already sent: the failure is reported inside the stream
    expect(res.body).toContain('event: error\ndata: {"detail":"The assistant ran into a problem. Please try again."}');
    expect(res.body).not.toContain("upstream died");
    expect(res.body.trimEnd().endsWith("event: done\ndata: {}")).toBe(true);
  });

  it("validates before opening a stream, and maps upstream failures before any event is sent", async () => {
    const a = build(vi.fn(async () => json({ detail: "busy" }, 429)));
    expect((await a.inject({ method: "POST", url: "/api/chat/stream", payload: { query: "" } })).statusCode).toBe(422);
    const busy = await a.inject({ method: "POST", url: "/api/chat/stream", payload: { query: "hi" } });
    expect(busy.statusCode).toBe(429);
    expect(busy.headers["content-type"]).toContain("application/json");
  });

  it("stops the upstream call when the browser disconnects", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const fetchStub = vi.fn(async (_url: string, init: RequestInit) => {
      upstreamSignal = init.signal as AbortSignal;
      // A stream that never ends and never yields: the AI service is still thinking.
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 });
    });
    const a = build(fetchStub as never);
    const address = await a.listen({ port: 0, host: "127.0.0.1" });

    const login = await fetch(`${address}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(LOGIN),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;

    const controller = new AbortController();
    const request = fetch(`${address}/api/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ query: "hi" }),
      signal: controller.signal,
    }).catch(() => undefined);
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined());
    expect(upstreamSignal!.aborted).toBe(false);

    controller.abort(); // the user closed the tab
    await request;
    await vi.waitFor(() => expect(upstreamSignal!.aborted).toBe(true), { timeout: 3000 });
  });
});

describe("GET /api/evidence/:name", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

  it("relays the screenshot with the token and a private cache header", async () => {
    const fetchStub = vi.fn(async () => new Response(png, { status: 200, headers: { "content-type": "image/png" } }));
    const res = await build(fetchStub, { token: "s3cret" }).inject({ method: "GET", url: "/api/evidence/valid_recharge_e2e.png" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toContain("private");
    expect(Buffer.from(res.rawPayload).equals(png)).toBe(true);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://ai.internal:8100/evidence/valid_recharge_e2e.png");
    expect(new Headers(init.headers).get("x-internal-token")).toBe("s3cret");
  });

  it.each(["notes.txt", "..%2Fsecret.png", "%2e%2e%2fsecret.png", "a%2Fb.png", "..%5Csecret.png", "x.png%00"])(
    "refuses %s without asking the AI service",
    async (name) => {
      const fetchStub = vi.fn(async () => new Response(png));
      const res = await build(fetchStub).inject({ method: "GET", url: `/api/evidence/${name}` });
      expect(res.statusCode).toBe(404);
      expect(fetchStub).not.toHaveBeenCalled();
    },
  );

  it("passes a missing screenshot on as 404", async () => {
    const res = await build(vi.fn(async () => json({ detail: "Not Found" }, 404))).inject({ method: "GET", url: "/api/evidence/gone.png" });
    expect(res.statusCode).toBe(404);
  });
});

describe("rate limiting", () => {
  it("limits chat calls per client, and nothing else", async () => {
    const a = build(vi.fn(async () => json(AI_RESPONSE)), { rateLimitPerMinute: 3 });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await chat(a, { query: "hi" })).statusCode);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    const limited = await chat(a, { query: "hi" });
    expect(limited.json()).toEqual({ detail: "Too many requests. Please slow down." });
    expect((await a.inject({ method: "GET", url: "/api/customers" })).statusCode).toBe(200); // other routes are untouched
  });
});

describe("GET /api/health", () => {
  it("reports the assistant's readiness so the UI can say the models are still loading", async () => {
    const health = { status: "ok", ready: false, provider: "groq", model: "gpt-oss" };
    const res = await build(vi.fn(async () => json(health))).inject({ method: "GET", url: "/api/health" });
    expect(res.json()).toEqual({ status: "ok", assistant: health });
  });

  it("stays healthy, with no assistant, when the AI service is down or not configured", async () => {
    const down = await build(vi.fn(async () => Promise.reject(new Error("down")))).inject({ method: "GET", url: "/api/health" });
    expect(down.json()).toEqual({ status: "ok", assistant: null });
    const none = await build(undefined).inject({ method: "GET", url: "/api/health" });
    expect(none.json()).toEqual({ status: "ok", assistant: null });
  });
});
