/**
 * AEGIS API — Unified entry point
 *
 * Selects the real HTTP client or in-memory mock client based on
 * the NEXT_PUBLIC_DEMO_MODE environment variable.
 *
 * Usage:
 *   import { getApiClient } from '@/lib/api';
 *   const api = getApiClient();
 *   const health = await api.getHealth();
 */

export * from "./types";

import { AegisApiClient, aegisApi } from "./client";
import { MockApiClient, mockApi } from "./mock-client";

/** Shared interface covering every method both clients expose. */
export type ApiClient = AegisApiClient | MockApiClient;

/**
 * Returns the appropriate API client singleton.
 *
 * - When `NEXT_PUBLIC_DEMO_MODE=true`, returns the mock client
 *   that uses in-memory data with simulated latency.
 * - Otherwise, returns the real HTTP client pointed at
 *   `NEXT_PUBLIC_AEGIS_API_URL`.
 */
export function getApiClient(): ApiClient {
  const isDemoMode =
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  return isDemoMode ? mockApi : aegisApi;
}

/**
 * Type guard to check if the client is a MockApiClient.
 * Useful when you need demo-only features like `getDashboardMetrics()`.
 */
export function isMockClient(client: ApiClient): client is MockApiClient {
  return client instanceof MockApiClient;
}

// Re-export concrete classes for advanced use / testing
export { AegisApiClient, aegisApi } from "./client";
export { MockApiClient, mockApi } from "./mock-client";
export { AegisApiError } from "./client";
