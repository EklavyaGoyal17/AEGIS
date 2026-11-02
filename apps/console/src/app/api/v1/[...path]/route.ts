/**
 * Server-side proxy from the console to the AEGIS v1 API.
 *
 * Why it exists: the AEGIS API only accepts verified bearer tokens and derives tenant and roles from
 * them. Tokens must never live in the browser, so the browser calls this same-origin route and the
 * server attaches the operator credential.
 *
 * Credential modes (AEGIS_CONSOLE_AUTH_MODE):
 *   forward     — production: an upstream SSO/OIDC proxy authenticates the operator and sets the
 *                 Authorization header; it is forwarded unchanged. Requests without it are rejected.
 *   dev-signer  — local development only (refused when NODE_ENV=production): mints a 2-minute RS256 token
 *                 for AEGIS_CONSOLE_DEV_SUBJECT with the key from `npm run dev:init`.
 * Anything else fails closed with 503.
 */
import { readFile } from "node:fs/promises";
import { importPKCS8, SignJWT } from "jose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ALLOWED: Array<[string, RegExp]> = [
  ["GET", /^health$/],
  ["GET", /^approvals$/],
  ["POST", new RegExp(`^approvals/${UUID}/resolve$`)],
  ["GET", /^audit\/events$/],
  ["GET", /^policies$/],
  ["POST", /^policies$/],
];
const MAX_BODY = 64 * 1024;
const FORWARDED_REQUEST_HEADERS = ["content-type", "idempotency-key", "x-correlation-id"];

function envelope(status: number, code: string, message: string) {
  return Response.json(
    { error: { code, message, correlationId: crypto.randomUUID(), retryable: status === 503 } },
    { status },
  );
}

let devKey: Promise<CryptoKey> | undefined;

async function credential(request: Request): Promise<string | Response> {
  const mode = process.env.AEGIS_CONSOLE_AUTH_MODE;
  if (mode === "forward") {
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) return envelope(401, "UNAUTHENTICATED", "Operator is not signed in");
    return header;
  }
  if (mode === "dev-signer") {
    if (process.env.NODE_ENV === "production") {
      return envelope(503, "UNAVAILABLE", "dev-signer authentication is disabled in production");
    }
    const keyFile = process.env.AEGIS_CONSOLE_DEV_SIGNING_KEY_FILE;
    const subject = process.env.AEGIS_CONSOLE_DEV_SUBJECT;
    const issuer = process.env.JWT_ISSUER;
    const audience = process.env.JWT_AUDIENCE;
    if (!keyFile || !subject || !issuer || !audience) {
      return envelope(503, "UNAVAILABLE", "Console dev-signer is not configured");
    }
    devKey ??= readFile(keyFile, "utf8").then((pem) => importPKCS8(pem, "RS256"));
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(await devKey);
    return `Bearer ${token}`;
  }
  return envelope(503, "UNAVAILABLE", "Console authentication is not configured (AEGIS_CONSOLE_AUTH_MODE)");
}

/** State-changing calls must come from this console's own pages (CSRF defence for ambient credentials). */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

async function proxy(request: Request, params: Promise<{ path: string[] }>): Promise<Response> {
  const path = (await params).path.join("/");
  if (!ALLOWED.some(([method, re]) => method === request.method && re.test(path))) {
    return envelope(404, "NOT_FOUND", "Route is not exposed through the console");
  }
  if (request.method !== "GET" && !sameOrigin(request)) {
    return envelope(403, "FORBIDDEN", "Cross-site request rejected");
  }
  const auth = await credential(request);
  if (auth instanceof Response) return auth;

  const headers: Record<string, string> = { accept: "application/json", authorization: auth };
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  let body: string | undefined;
  if (request.method === "POST") {
    body = await request.text();
    if (body.length > MAX_BODY) return envelope(413, "PAYLOAD_TOO_LARGE", "Request body too large");
  }

  const upstream = new URL(`/v1/${path}`, process.env.AEGIS_API_URL ?? "http://127.0.0.1:3000");
  upstream.search = new URL(request.url).search;
  let response: Response;
  try {
    response = await fetch(upstream, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    return envelope(503, "UNAVAILABLE", "AEGIS API is unreachable");
  }
  // Only the JSON body and status are relayed; upstream cookies and hop-by-hop headers are dropped.
  return new Response(await response.text(), {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, context: Context) {
  return proxy(request, context.params);
}
export async function POST(request: Request, context: Context) {
  return proxy(request, context.params);
}
