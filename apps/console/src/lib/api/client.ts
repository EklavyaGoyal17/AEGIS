/**
 * AEGIS API Client — typed HTTP client for the AEGIS v1 API.
 *
 * The browser talks only to the console's own origin (`/api/v1/*`). That route is a server-side proxy
 * (src/app/api/v1/[...path]/route.ts) which attaches the operator's credential; the browser never holds
 * an AEGIS token. Every response is validated against the frozen v1 contract and mapped to view models.
 */

import { z } from "zod";
import type {
  Approval,
  ApprovalFilters,
  ApprovalResolveRequest,
  ApprovalResolveResponse,
  AuditEvent,
  AuditFilters,
  CreatePolicyRequest,
  DecisionResponse,
  EvaluationRequest,
  HealthResponse,
  PaginatedResponse,
  Policy,
} from "@/lib/api/types";
import {
  toApproval,
  toAuditEvent,
  toCreatePolicyRequest,
  toDecision,
  toHealth,
  toPage,
  toPolicy,
  WireApproval,
  WireAuditEvent,
  WireDecision,
  WireErrorEnvelope,
  WireHealth,
  wirePage,
  WirePolicy,
  WirePolicyVersion,
} from "@/lib/api/contract";

// ─── Error class ─────────────────────────────────────────────────
export class AegisApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details: Record<string, unknown> | undefined;

  constructor(
    message: string,
    statusCode: number,
    errorCode: string = "UNKNOWN_ERROR",
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AegisApiError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}

const newRequestId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-000000000000".replace(/0/g, () => Math.floor(Math.random() * 16).toString(16));

// ─── Client ──────────────────────────────────────────────────────
export class AegisApiClient {
  private readonly baseUrl: string;

  /** `baseUrl` defaults to the console's own origin, where the authenticated proxy lives. */
  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined | null>,
  ): string {
    const origin =
      this.baseUrl ||
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:3100");
    const url = new URL(`${origin}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async request<W, V>(
    url: string,
    schema: z.ZodType<W>,
    map: (wire: W) => V,
    init: RequestInit = {},
  ): Promise<V> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    };

    let response: Response;
    try {
      response = await fetch(url, { ...init, headers, credentials: "same-origin" });
    } catch (err) {
      throw new AegisApiError(
        err instanceof Error ? `Network error: ${err.message}` : "An unknown network error occurred",
        0,
        "NETWORK_ERROR",
      );
    }

    if (!response.ok) {
      let envelope: z.infer<typeof WireErrorEnvelope> | null = null;
      try {
        const parsed = WireErrorEnvelope.safeParse(await response.json());
        if (parsed.success) envelope = parsed.data;
      } catch {
        // Body is not JSON — fall through to a generic error.
      }
      throw new AegisApiError(
        envelope?.error.message ?? `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        envelope?.error.code ?? "HTTP_ERROR",
        envelope ? { correlationId: envelope.error.correlationId, retryable: envelope.error.retryable } : undefined,
      );
    }

    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      throw new AegisApiError(
        `Response does not match the AEGIS v1 contract: ${parsed.error.message}`,
        response.status,
        "CONTRACT_VIOLATION",
        { zodErrors: parsed.error.flatten() },
      );
    }
    return map(parsed.data);
  }

  // ── Decisions ────────────────────────────────────────────────

  /**
   * Console-side evaluation (e.g. "test this request"). Agents evaluate with their own credentials via
   * the SDK; the console's credential is a human operator's.
   */
  async evaluateDecision(req: EvaluationRequest): Promise<DecisionResponse> {
    const [type, ...rest] = req.resource.split("/");
    return this.request(this.buildUrl("/api/v1/decisions/evaluate"), WireDecision, toDecision, {
      method: "POST",
      body: JSON.stringify({
        requestId: newRequestId(),
        agentId: req.agentId,
        action: req.action,
        resource: { type, id: rest.join("/") || type, attributes: {} },
        context: req.context ?? {},
      }),
    });
  }

  // ── Approvals ────────────────────────────────────────────────

  async getApprovals(filters?: ApprovalFilters): Promise<PaginatedResponse<Approval>> {
    return this.request(
      this.buildUrl("/api/v1/approvals", {
        status: filters?.status,
        agentId: filters?.agentId,
        limit: Math.min(filters?.pageSize ?? 50, 200),
      }),
      wirePage(WireApproval),
      (page) => toPage(page, toApproval),
    );
  }

  async resolveApproval(approvalId: string, req: ApprovalResolveRequest): Promise<ApprovalResolveResponse> {
    if (!req.expectedBindingDigest) {
      throw new AegisApiError(
        "Cannot resolve: the reviewed approval's binding digest is missing.",
        0,
        "BINDING_DIGEST_REQUIRED",
      );
    }
    return this.request(
      this.buildUrl(`/api/v1/approvals/${encodeURIComponent(approvalId)}/resolve`),
      WireApproval,
      (a) => ({
        approvalId: a.approvalId,
        status: a.status,
        resolvedAt: a.resolution?.resolvedAt ?? new Date().toISOString(),
        resolvedBy: a.resolution?.resolvedBy ?? "",
      }),
      {
        method: "POST",
        headers: { "Idempotency-Key": newRequestId() },
        body: JSON.stringify({
          decision: req.action,
          expectedBindingDigest: req.expectedBindingDigest,
          ...(req.reason ? { comment: req.reason.slice(0, 2000) } : {}),
        }),
      },
    );
  }

  // ── Audit Events ─────────────────────────────────────────────

  async getAuditEvents(filters?: AuditFilters): Promise<PaginatedResponse<AuditEvent>> {
    return this.request(
      this.buildUrl("/api/v1/audit/events", {
        from: filters?.startDate,
        to: filters?.endDate,
        agentId: filters?.agentId,
        type: filters?.eventType,
        limit: Math.min(filters?.pageSize ?? 50, 200),
      }),
      wirePage(WireAuditEvent),
      (page) => toPage(page, toAuditEvent),
    );
  }

  // ── Policies ─────────────────────────────────────────────────

  async getPolicies(): Promise<Policy[]> {
    return this.request(this.buildUrl("/api/v1/policies", { limit: 200 }), wirePage(WirePolicy), (page) =>
      page.items.map(toPolicy),
    );
  }

  async createPolicy(req: CreatePolicyRequest): Promise<Policy> {
    const body = toCreatePolicyRequest(req);
    return this.request(
      this.buildUrl("/api/v1/policies"),
      WirePolicyVersion,
      (v) => ({
        policyId: v.policyId,
        name: req.name,
        description: req.description,
        version: `${v.version}`,
        enabled: v.state === "ACTIVE",
        rules: req.rules,
        createdAt: v.createdAt,
        updatedAt: v.createdAt,
        createdBy: v.createdBy,
      }),
      { method: "POST", headers: { "Idempotency-Key": newRequestId() }, body: JSON.stringify(body) },
    );
  }

  // ── Health ───────────────────────────────────────────────────

  async getHealth(): Promise<HealthResponse> {
    return this.request(this.buildUrl("/api/v1/health"), WireHealth, toHealth);
  }
}

// ─── Singleton instance ──────────────────────────────────────────
// Same-origin by default; NEXT_PUBLIC_AEGIS_API_URL only overrides where the console proxy is hosted.
export const aegisApi = new AegisApiClient(
  typeof process !== "undefined" ? (process.env.NEXT_PUBLIC_AEGIS_API_URL ?? "") : "",
);
