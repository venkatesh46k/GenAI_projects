import { existsSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyRequest, FastifyServerOptions } from "fastify";
import { createServer, parse } from "./app.js";
import { chatRoutes, type AiConfig } from "./chat.js";
import { HttpError } from "./errors.js";
import { CustomerRechargeBody, CustomersQuery, LoginBody, type CustomerOverview, type SessionUser } from "./schemas.js";
import { COOKIE_NAME, DEFAULT_TTL_SECONDS, decodeSession, encodeSession } from "./session.js";
import * as billing from "./service.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The signed-in user; null on the few public routes. */
    user: SessionUser | null;
  }
}

export const DEFAULT_WEB_DIST = path.resolve(import.meta.dirname, "../../../web/dist");

export interface WebConfig {
  /** Secret that signs the session cookie (at least 32 characters in production). */
  sessionSecret: string;
  /** Set the cookie's Secure flag: true whenever the site is served over https. */
  cookieSecure?: boolean;
  sessionTtlSeconds?: number;
  /** The AI service the chat routes forward to. Without it they answer 503 "not configured". */
  ai?: AiConfig;
  /** Built React app to serve. Skipped (API only) when the folder does not exist. */
  staticDir?: string;
  loginRateLimitPerMinute?: number;
}

const PUBLIC_ROUTES = new Set(["POST /api/session", "GET /api/health"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The PUBLIC server: the only thing a browser talks to. Sign-in, the aggregated /api endpoints, the chat proxy and the
 * built front-end. It reads the same database as the internal billing API but exposes none of its routes directly.
 */
export function buildWebApp(db: DatabaseSync, options: FastifyServerOptions = {}, config: WebConfig): FastifyInstance {
  const staticDir = config.staticDir ?? DEFAULT_WEB_DIST;
  const serveSpa = existsSync(path.join(staticDir, "index.html"));
  const ttl = config.sessionTtlSeconds ?? DEFAULT_TTL_SECONDS;

  const app = createServer(options, (req, reply) => {
    // Unknown /api paths are API errors; a path with a file extension is a missing file (a stale asset URL must be a 404,
    // not an HTML page a browser then refuses as a script); any other unknown GET is a front-end route the SPA resolves.
    const pathname = req.url.split("?")[0] ?? "";
    if (serveSpa && req.method === "GET" && !pathname.startsWith("/api/") && !path.extname(pathname)) {
      return reply.type("text/html").sendFile("index.html");
    }
    return reply.code(404).send({ detail: "Not Found" });
  });

  app.decorateRequest("user", null);

  void app.register(helmet, {
    // The app loads nothing from other origins: scripts and styles from itself, images from itself or inline data.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // component libraries set inline styles for positioning
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    hsts: config.cookieSecure ? undefined : false, // only tell browsers to insist on https when we are served over it
  });
  void app.register(cookie, { secret: config.sessionSecret });
  void app.register(rateLimit, { global: false });

  function currentUser(req: FastifyRequest): SessionUser | null {
    const raw = req.cookies[COOKIE_NAME];
    if (!raw) return null;
    const unsigned = req.unsignCookie(raw);
    return unsigned.valid && unsigned.value ? decodeSession(unsigned.value) : null;
  }

  // Every /api route needs a session except the few public ones; state-changing requests must be same-origin.
  app.addHook("onRequest", async (req) => {
    const url = req.url.split("?")[0] ?? "";
    if (!url.startsWith("/api/")) return;
    if (!SAFE_METHODS.has(req.method) && req.headers.origin) {
      // A browser attaches Origin to cross-site requests: refuse those (belt and braces on top of SameSite=Lax).
      let origin = "";
      try {
        origin = new URL(req.headers.origin).host;
      } catch {
        /* an unparsable Origin is refused below */
      }
      if (origin !== req.headers.host) throw new HttpError(403, "Cross-origin request refused");
    }
    if (PUBLIC_ROUTES.has(`${req.method} ${url}`)) return;
    req.user = currentUser(req);
    if (!req.user) throw new HttpError(401, "Sign in required");
  });

  void app.register(async (api) => {
    // ------------------------------------------------------------------ session (demo sign-in: name and role)

    api.post(
      "/api/session",
      { config: { rateLimit: { max: config.loginRateLimitPerMinute ?? 10, timeWindow: "1 minute" } } },
      async (req, reply): Promise<SessionUser> => {
        const user = parse(LoginBody, req.body, "body");
        reply.setCookie(COOKIE_NAME, encodeSession(user, ttl), {
          path: "/",
          httpOnly: true, // invisible to scripts, so an XSS bug cannot read it
          sameSite: "lax",
          secure: config.cookieSecure ?? false,
          maxAge: ttl,
          signed: true,
        });
        req.log.info({ user: user.name, role: user.role }, "signed in");
        return user;
      },
    );

    api.get("/api/session", async (req): Promise<SessionUser> => req.user!);

    api.delete("/api/session", async (req, reply) => {
      reply.clearCookie(COOKIE_NAME, { path: "/" });
      req.log.info({ user: req.user?.name }, "signed out");
      return reply.code(204).send();
    });

    // ------------------------------------------------------------------ customers (aggregated for the screens)

    api.get("/api/customers", async (req) => {
      const query = parse(CustomersQuery, req.query, "query");
      return billing.listSubscribers(db, query);
    });

    api.get<{ Params: { msisdn: string } }>("/api/customers/:msisdn/overview", async (req): Promise<CustomerOverview> =>
      billing.customerOverview(db, req.params.msisdn),
    );

    api.post<{ Params: { msisdn: string } }>("/api/customers/:msisdn/recharge", async (req) => {
      const body = parse(CustomerRechargeBody, req.body, "body");
      const receipt = billing.recharge(db, { msisdn: req.params.msisdn, ...body });
      // The audit trail: who did what. (The demo tables carry no user column, so it lives in the log.)
      req.log.info({ user: req.user?.name, msisdn: req.params.msisdn, amount: body.amount, txn: receipt.txn_id }, "recharge");
      return receipt;
    });

    api.get("/api/plans", async () => billing.listPlans(db));

    api.post<{ Params: { dispute_id: string } }>("/api/disputes/:dispute_id/escalate", async (req) => {
      const result = billing.escalateDispute(db, req.params.dispute_id);
      req.log.info({ user: req.user?.name, dispute: result.dispute_id, ticket: result.ticket_id }, "dispute escalated");
      return result;
    });
  });

  void app.register(chatRoutes(config.ai));

  if (serveSpa) {
    void app.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
      // Hashed asset files never change, so they can be cached for a year; the HTML shell must always be revalidated.
      setHeaders: (res, filePath) => {
        res.header("cache-control", filePath.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
  }

  return app;
}
