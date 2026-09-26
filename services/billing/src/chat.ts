import { Readable } from "node:stream";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { HttpError } from "./errors.js";
import type { components } from "./generated/ai-service.js";

/** Types come from the AI service's OpenAPI contract (`npm run gen:ai-types`), so they cannot drift from the Python side. */
export type ChatResponse = components["schemas"]["ChatResponse"];
export type AiHealth = components["schemas"]["HealthResponse"];

export interface AiConfig {
  /** Base URL of the AI service, e.g. http://127.0.0.1:8100. Internal: never exposed to browsers. */
  url: string;
  /** Shared secret sent as X-Internal-Token. */
  token?: string;
  /** Upper bound for one chat call. Generous: the first request after a start loads the models. */
  timeoutMs: number;
  /** Requests per client per minute on the chat routes. */
  rateLimitPerMinute?: number;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

const ChatBody = z.strictObject({
  query: z.string().min(1).max(2000),
  msisdn: z.string().regex(/^\d{10}$/).nullable().optional(),
});

const EVIDENCE_NAME = /^[A-Za-z0-9_.-]+\.png$/;

const MESSAGES = {
  unavailable: "The assistant is unavailable. Please try again shortly.",
  timeout: "The assistant took too long to answer. Please try again.",
  busy: "The assistant is busy. Please try again shortly.",
  failed: "The assistant ran into a problem. Please try again.",
  notConfigured: "The assistant is not configured.",
} as const;

/** The AI service serves screenshots from /evidence/...; browsers reach them through this tier under /api. */
function publicEvidence(response: ChatResponse): ChatResponse {
  const url = response.test_result?.evidence_url;
  if (response.test_result && url?.startsWith("/evidence/")) {
    return { ...response, test_result: { ...response.test_result, evidence_url: `/api${url}` } };
  }
  return response;
}

/** Rewrites the screenshot URL inside `result` events; every other event and comment passes through untouched. */
async function* rewriteEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  const emit = (block: string): string => {
    if (block.startsWith("event: result")) {
      const lines = block.split("\n").map((line) => {
        if (!line.startsWith("data: ")) return line;
        try {
          return `data: ${JSON.stringify(publicEvidence(JSON.parse(line.slice(6)) as ChatResponse))}`;
        } catch {
          return line;
        }
      });
      return lines.join("\n");
    }
    return block;
  };
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      yield `${emit(buffer.slice(0, end))}\n\n`;
      buffer = buffer.slice(end + 2);
    }
  }
  if (buffer.trim()) yield emit(buffer);
}

export function chatRoutes(ai: AiConfig | undefined): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    const limit = { max: ai?.rateLimitPerMinute ?? 20, timeWindow: "1 minute" };
    const doFetch = ai?.fetch ?? fetch;

    async function callAi(path: string, init: RequestInit, requestId: string, signal?: AbortSignal): Promise<Response> {
      if (!ai) throw new HttpError(503, MESSAGES.notConfigured);
      const headers = new Headers(init.headers);
      headers.set("x-request-id", requestId); // the AI service logs the same id: one request, traceable end to end
      if (ai.token) headers.set("x-internal-token", ai.token);
      const timeout = AbortSignal.timeout(ai.timeoutMs);
      let response: Response;
      try {
        response = await doFetch(`${ai.url}${path}`, { ...init, headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
          throw new HttpError(504, MESSAGES.timeout);
        }
        throw new HttpError(503, MESSAGES.unavailable);
      }
      if (response.ok) return response;
      if (response.status === 429) throw new HttpError(429, MESSAGES.busy);
      if (response.status === 404) throw new HttpError(404, "Not Found");
      // 401/403 mean our shared secret is wrong (a deployment mistake), 5xx mean the service failed: either way the
      // browser gets a generic message and the details stay in the log.
      app.log.error({ status: response.status, path }, "AI service returned an error");
      throw new HttpError(502, MESSAGES.failed);
    }

    const post = (body: unknown): RequestInit => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    function parseBody(raw: unknown) {
      const result = ChatBody.safeParse(raw);
      if (!result.success) {
        throw new HttpError(
          422,
          result.error.issues.map((i) => ({ loc: ["body", ...i.path], msg: i.message, type: i.code })),
        );
      }
      return result.data;
    }

    app.post("/api/chat", { config: { rateLimit: limit } }, async (req): Promise<ChatResponse> => {
      const body = parseBody(req.body);
      const response = await callAi("/chat", post(body), req.id);
      return publicEvidence((await response.json()) as ChatResponse);
    });

    app.post("/api/chat/stream", { config: { rateLimit: limit } }, async (req, reply) => {
      const body = parseBody(req.body);
      const gone = new AbortController();
      // If the browser leaves mid-answer, stop waiting on the AI service instead of holding the connection open.
      reply.raw.on("close", () => {
        if (!reply.raw.writableFinished) gone.abort();
      });
      const upstream = await callAi("/chat/stream", post(body), req.id, gone.signal);
      if (!upstream.body) throw new HttpError(502, MESSAGES.failed);

      async function* events(): AsyncGenerator<string> {
        try {
          yield* rewriteEvents(upstream.body!);
        } catch {
          // The upstream died mid-answer (or the client left): finish the stream cleanly with a safe error event.
          yield `event: error\ndata: ${JSON.stringify({ detail: MESSAGES.failed })}\n\nevent: done\ndata: {}\n\n`;
        }
      }

      return reply
        .header("content-type", "text/event-stream; charset=utf-8")
        .header("cache-control", "no-cache")
        .header("x-accel-buffering", "no")
        .send(Readable.from(events()));
    });

    app.get<{ Params: { name: string } }>("/api/evidence/:name", async (req, reply) => {
      if (!EVIDENCE_NAME.test(req.params.name)) throw new HttpError(404, "Not Found");
      const upstream = await callAi(`/evidence/${req.params.name}`, { method: "GET" }, req.id);
      return reply
        .header("content-type", "image/png")
        .header("cache-control", "private, max-age=300")
        .send(Buffer.from(await upstream.arrayBuffer()));
    });

    app.get("/api/health", async (req) => {
      let assistant: AiHealth | null = null;
      if (ai) {
        try {
          const response = await doFetch(`${ai.url}/health`, { signal: AbortSignal.timeout(2000) });
          if (response.ok) assistant = (await response.json()) as AiHealth;
        } catch {
          req.log.warn("AI service health check failed");
        }
      }
      return { status: "ok" as const, assistant };
    });
  };
}
