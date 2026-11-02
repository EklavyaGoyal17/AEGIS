import { AegisClient, type AegisClientOptions, type Logger } from '../src/index.js';

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Step = Response | Error | ((call: RecordedCall, signal: AbortSignal) => Response | Promise<Response>);

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export const envelope = (code: string, retryable: boolean, message = 'x') => ({
  error: { code, message, correlationId: 'srv-corr', retryable },
});

/** A fetch that replays scripted steps and records what the client sent. */
export function scriptedFetch(steps: Step[]) {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fetchImpl = (async (input: URL | string | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const call: RecordedCall = {
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step === undefined) throw new Error('no scripted response');
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step(call, init?.signal ?? new AbortController().signal);
    return step.clone();
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

/** Resolves only when aborted (simulates a hung server). */
export const hang = (_c: RecordedCall, signal: AbortSignal) =>
  new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

export const TOKEN = 'eyJ.super-secret-token.sig';

export function client(fetchImpl: typeof fetch, extra: Partial<AegisClientOptions> = {}, logger?: Logger) {
  let n = 0;
  return new AegisClient({
    baseUrl: 'https://aegis.test',
    credentials: { getToken: async () => TOKEN },
    fetch: fetchImpl,
    timeoutMs: 50,
    deadlineMs: 2000,
    retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
    randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    random: () => 0.5,
    sleep: async () => undefined,
    ...(logger ? { logger } : {}),
    ...extra,
  });
}

export const evaluateRequest = () => ({
  requestId: '0b5f1d2e-8a4c-4e7b-9f61-2d3c4b5a6978',
  agentId: 'agent-crm',
  action: 'crm.customers.export',
  resource: { type: 'crm.customer_table', id: 'customers', attributes: { recordCount: 500 } },
  context: {},
});

export const decision = (effect: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL', extra: Record<string, unknown> = {}) => ({
  decisionId: '7b6a5948-3726-4154-a3b2-c1d0e9f8a7b6',
  effect,
  reasonCodes: [effect === 'ALLOW' ? 'POLICY_ALLOW' : effect === 'DENY' ? 'EXPLICIT_DENY' : 'APPROVAL_REQUIRED'],
  policyVersion: 'r1.abcdef012345',
  approvalId: effect === 'REQUIRE_APPROVAL' ? '3c9a4f1e-2b7d-4e8a-9c6f-1d2e3f4a5b6c' : null,
  expiresAt: '2999-01-01T00:00:00Z',
  ...extra,
});
