/**
 * AEGIS API Client — Typed HTTP client for the AEGIS Policy Engine V1 API
 *
 * All requests use fetch() with Zod schema validation on responses.
 * Network and API errors are normalized into a consistent `AegisApiError` class.
 */

import { z } from "zod";
import type {
  EvaluationRequest,
  DecisionResponse,
  Approval,
  ApprovalFilters,
  ApprovalResolveRequest,
  ApprovalResolveResponse,
  AuditEvent,
  AuditFilters,
  Policy,
  CreatePolicyRequest,
  HealthResponse,
  PaginatedResponse,
} from "@/lib/api/types";
import {
  DecisionResponseSchema,
  ApprovalSchema,
  ApprovalResolveResponseSchema,
  AuditEventSchema,
  PolicySchema,
  HealthResponseSchema,
  PaginatedResponseSchema,
  ApiErrorSchema,
} from "@/lib/api/types";

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

// ─── Client ──────────────────────────────────────────────────────
export class AegisApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    // Strip trailing slash for consistency
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  // ── Internal helpers ─────────────────────────────────────────

  /**
   * Build a URL with optional query parameters.
   * `undefined` and `null` values are omitted.
   */
  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined | null>,
  ): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  /**
   * Execute a fetch request with standard headers, error handling,
   * and Zod schema validation on the response body.
   */
  private async request<T>(
    url: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    };

    let response: Response;

    try {
      response = await fetch(url, { ...init, headers });
    } catch (err) {
      throw new AegisApiError(
        err instanceof Error
          ? `Network error: ${err.message}`
          : "An unknown network error occurred",
        0,
        "NETWORK_ERROR",
      );
    }

    if (!response.ok) {
      let apiError: { error: string; message: string; details?: Record<string, unknown> } | null =
        null;

      try {
        const body: unknown = await response.json();
        const parsed = ApiErrorSchema.safeParse(body);
        if (parsed.success) {
          apiError = parsed.data;
        }
      } catch {
        // Body is not JSON — fall through to generic error
      }

      throw new AegisApiError(
        apiError?.message ?? `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        apiError?.error ?? "HTTP_ERROR",
        apiError?.details,
      );
    }

    const body: unknown = await response.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      throw new AegisApiError(
        `Response validation failed: ${parsed.error.message}`,
        response.status,
        "VALIDATION_ERROR",
        { zodErrors: parsed.error.flatten() },
      );
    }

    return parsed.data;
  }

  // ── Decisions ────────────────────────────────────────────────

  async evaluateDecision(req: EvaluationRequest): Promise<DecisionResponse> {
    return this.request(
      this.buildUrl("/api/v1/decisions/evaluate"),
      DecisionResponseSchema,
      { method: "POST", body: JSON.stringify(req) },
    );
  }

  // ── Approvals ────────────────────────────────────────────────

  async getApprovals(
    filters?: ApprovalFilters,
  ): Promise<PaginatedResponse<Approval>> {
    return this.request(
      this.buildUrl("/api/v1/approvals", {
        status: filters?.status,
        agentId: filters?.agentId,
        page: filters?.page,
        pageSize: filters?.pageSize,
      }),
      PaginatedResponseSchema(ApprovalSchema),
    );
  }

  async resolveApproval(
    approvalId: string,
    req: ApprovalResolveRequest,
  ): Promise<ApprovalResolveResponse> {
    return this.request(
      this.buildUrl(`/api/v1/approvals/${encodeURIComponent(approvalId)}/resolve`),
      ApprovalResolveResponseSchema,
      { method: "POST", body: JSON.stringify(req) },
    );
  }

  // ── Audit Events ─────────────────────────────────────────────

  async getAuditEvents(
    filters?: AuditFilters,
  ): Promise<PaginatedResponse<AuditEvent>> {
    return this.request(
      this.buildUrl("/api/v1/audit/events", {
        startDate: filters?.startDate,
        endDate: filters?.endDate,
        agentId: filters?.agentId,
        action: filters?.action,
        effect: filters?.effect,
        correlationId: filters?.correlationId,
        eventType: filters?.eventType,
        page: filters?.page,
        pageSize: filters?.pageSize,
      }),
      PaginatedResponseSchema(AuditEventSchema),
    );
  }

  // ── Policies ─────────────────────────────────────────────────

  async getPolicies(): Promise<Policy[]> {
    return this.request(
      this.buildUrl("/api/v1/policies"),
      z.array(PolicySchema),
    );
  }

  async createPolicy(req: CreatePolicyRequest): Promise<Policy> {
    return this.request(
      this.buildUrl("/api/v1/policies"),
      PolicySchema,
      { method: "POST", body: JSON.stringify(req) },
    );
  }

  // ── Health ───────────────────────────────────────────────────

  async getHealth(): Promise<HealthResponse> {
    return this.request(
      this.buildUrl("/api/v1/health"),
      HealthResponseSchema,
    );
  }
}

// ─── Singleton instance ──────────────────────────────────────────
const apiBaseUrl =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_AEGIS_API_URL ?? "http://localhost:3100"
    : "http://localhost:3100";

export const aegisApi = new AegisApiClient(apiBaseUrl);
