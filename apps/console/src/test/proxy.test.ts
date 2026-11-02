// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/v1/[...path]/route";

const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
const req = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(`http://localhost:3100/api/v1/${path}`, init);

let upstream: ReturnType<typeof vi.fn>;
const env = { ...process.env };

beforeEach(() => {
  upstream = vi.fn(async () => Response.json({ items: [], nextCursor: null }));
  vi.stubGlobal("fetch", upstream);
  const dir = mkdtempSync(join(tmpdir(), "aegis-console-"));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(join(dir, "private.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));
  Object.assign(process.env, {
    AEGIS_CONSOLE_AUTH_MODE: "dev-signer",
    AEGIS_CONSOLE_DEV_SIGNING_KEY_FILE: join(dir, "private.pem"),
    AEGIS_CONSOLE_DEV_SUBJECT: "demo-human",
    JWT_ISSUER: "https://identity.aegis.local.invalid",
    JWT_AUDIENCE: "aegis-local",
    AEGIS_API_URL: "http://api.internal:3000",
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...env };
});

describe("console → AEGIS API proxy", () => {
  it("forwards allow-listed reads with a short-lived server-side token", async () => {
    const res = await GET(req("approvals?status=PENDING"), ctx("approvals"));
    expect(res.status).toBe(200);
    const [url, init] = upstream.mock.calls[0]! as [URL, RequestInit & { headers: Record<string, string> }];
    expect(String(url)).toBe("http://api.internal:3000/v1/approvals?status=PENDING");
    const claims = decodeJwt(init.headers.authorization!.slice(7));
    expect(claims.sub).toBe("demo-human");
    expect(claims.exp! - claims.iat!).toBe(120);
    expect(init.redirect).toBe("error");
  });

  it.each([
    ["GET", "decisions/evaluate"],
    ["POST", "decisions/evaluate"],
    ["GET", "../internal/metrics"],
    ["POST", "approvals/not-a-uuid/resolve"],
    ["GET", "internal/ready"],
  ])("does not expose %s %s", async (method, path) => {
    const handler = method === "GET" ? GET : POST;
    const res = await handler(
      req(path, { method, headers: { "sec-fetch-site": "same-origin" }, ...(method === "POST" ? { body: "{}" } : {}) }),
      ctx(path),
    );
    expect(res.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects cross-site state-changing requests (CSRF)", async () => {
    for (const headers of [{ "sec-fetch-site": "cross-site" }, { origin: "https://evil.example" }, {} as Record<string, string>]) {
      const res = await POST(req("policies", { method: "POST", headers, body: "{}" }), ctx("policies"));
      expect(res.status).toBe(403);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("allows same-origin writes and forwards the idempotency key", async () => {
    const res = await POST(
      req("policies", { method: "POST", headers: { "sec-fetch-site": "same-origin", "idempotency-key": "k-1", "content-type": "application/json" }, body: "{}" }),
      ctx("policies"),
    );
    expect(res.status).toBe(200);
    const [, init] = upstream.mock.calls[0]! as [URL, RequestInit & { headers: Record<string, string> }];
    expect(init.headers["idempotency-key"]).toBe("k-1");
  });

  it("refuses the dev signer in production and fails closed when unconfigured", async () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    expect((await GET(req("health"), ctx("health"))).status).toBe(503);
    Object.assign(process.env, { NODE_ENV: "test", AEGIS_CONSOLE_AUTH_MODE: "" });
    expect((await GET(req("health"), ctx("health"))).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forward mode requires and relays the upstream SSO credential", async () => {
    process.env.AEGIS_CONSOLE_AUTH_MODE = "forward";
    expect((await GET(req("approvals"), ctx("approvals"))).status).toBe(401);
    await GET(req("approvals", { headers: { authorization: "Bearer sso-token" } }), ctx("approvals"));
    const [, init] = upstream.mock.calls[0]! as [URL, RequestInit & { headers: Record<string, string> }];
    expect(init.headers.authorization).toBe("Bearer sso-token");
  });

  it("maps an unreachable API to 503 rather than a success", async () => {
    upstream.mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await GET(req("approvals"), ctx("approvals"));
    expect(res.status).toBe(503);
  });
});
