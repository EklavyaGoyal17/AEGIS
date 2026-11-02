import Fastify, { LogController } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Counter, Histogram, Registry } from 'prom-client';
import {
  context,
  propagation,
  ROOT_CONTEXT,
  trace,
  SpanStatusCode,
  type Span,
} from '@opentelemetry/api';
import {
  Authorization,
  policyWriteSchema,
  resolutionSchema,
} from './authorization.js';
import {
  DomainError,
  evaluationSchema,
  identifier,
  requireRole,
  type Principal,
} from './domain.js';
import { authenticateBearer, type IdentityConfig } from './identity.js';
import { audit, SYSTEM_TENANT } from './store.js';
import { executionSchema, type Gateway } from '../../gateway/src/gateway.js';
import { Cursors } from './cursors.js';

export interface AppOptions {
  authorization: Authorization;
  identity: IdentityConfig;
  gateway?: Gateway;
  surface?: 'api' | 'gateway';
  logger?: boolean;
  cursorKey?: string;
}
declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}
const common = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
};
const approvalQuery = z
  .object({
    ...common,
    status: z
      .enum([
        'PENDING',
        'APPROVED',
        'REJECTED',
        'EXPIRED',
        'CANCELLED',
        'CONSUMED',
      ])
      .optional(),
    agentId: identifier.optional(),
  })
  .strict();
const auditTypes = [
  'DECISION_EVALUATED',
  'APPROVAL_REQUESTED',
  'APPROVAL_RESOLVED',
  'APPROVAL_CONSUMED',
  'APPROVAL_EXPIRED',
  'EXECUTION_AUTHORIZED',
  'EXECUTION_REJECTED',
  'POLICY_CREATED',
  'POLICY_ACTIVATED',
  'AUTHENTICATION_FAILED',
  'AUTHORIZATION_ERROR',
] as const;
const auditQuery = z
  .object({
    ...common,
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    type: z.enum(auditTypes).optional(),
    agentId: identifier.optional(),
    decisionId: z.uuid().optional(),
  })
  .strict();
const policyQuery = z.object(common).strict();
function idempotency(headers: Record<string, unknown>) {
  const key = headers['idempotency-key'];
  return key === undefined ? undefined : z.uuid().parse(key);
}
export function buildApp(options?: AppOptions) {
  const app = Fastify({
    logger: options?.logger
      ? {
          level: 'info',
          redact: [
            'req.headers.authorization',
            'req.body',
            'res.headers["set-cookie"]',
          ],
          serializers: {
            req: (r) => ({ method: r.method }),
            res: (r) => ({ statusCode: r.statusCode }),
          },
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    requestTimeout: 15000,
    connectionTimeout: 10000,
    bodyLimit: 65536,
    trustProxy: false,
  });
  const registry = new Registry();
  const requests = new Counter({
    name: 'aegis_http_requests_total',
    help: 'HTTP requests',
    labelNames: ['route', 'status'],
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'aegis_http_duration_seconds',
    help: 'HTTP duration',
    labelNames: ['route'],
    registers: [registry],
  });
  const starts = new WeakMap<object, number>();
  const spans = new WeakMap<object, Span>();
  const cursors = new Cursors(
    options?.cursorKey ?? randomBytes(32).toString('hex'),
  );
  app.decorateRequest('principal', null);
  void app.register(rateLimit, { max: 240, timeWindow: '1 minute' });
  app.addHook('onRequest', async (request, reply) => {
    starts.set(request, performance.now());
    const parent = propagation.extract(ROOT_CONTEXT, request.headers);
    spans.set(
      request,
      trace.getTracer('aegis-http').startSpan(
        'aegis.request',
        {
          attributes: {
            'http.request.method': request.method,
            'aegis.correlation_id': request.id,
          },
        },
        parent,
      ),
    );
    reply
      .header('x-request-id', request.id)
      .header('x-correlation-id', request.id)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff');
  });
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? 'unmatched';
    requests.inc({ route, status: String(reply.statusCode) });
    duration.observe(
      { route },
      (performance.now() - (starts.get(request) ?? performance.now())) / 1000,
    );
    const span = spans.get(request);
    span?.setAttributes({
      'http.route': route,
      'http.response.status_code': reply.statusCode,
    });
    if (reply.statusCode >= 500)
      span?.setStatus({ code: SpanStatusCode.ERROR });
    span?.end();
  });
  app.get('/v1/health', async () => ({
    status: 'ok',
    apiVersion: '1.0.0',
    time: new Date().toISOString(),
  }));
  if (!options) return app;
  const { authorization, identity } = options;
  const store = authorization.store;
  app.get('/internal/ready', async (_request, reply) => {
    try {
      const result = await store.pool.query(
        'SELECT 1 FROM schema_migrations WHERE version=$1',
        ['004'],
      );
      if (
        !result.rowCount ||
        authorization.engine.name === 'unconfigured-fail-closed'
      )
        throw new Error();
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  app.addHook('preHandler', async (request) => {
    if (
      ['/v1/health', '/internal/ready'].includes(request.routeOptions.url ?? '')
    )
      return;
    request.principal = await authenticateBearer(
      request.headers.authorization,
      identity,
      store,
    );
    await store.rateLimit(request.principal);
    await store.transaction(request.principal.tenantId, async (tx) => {
      await store.currentPrincipal(tx, request.principal!);
      await audit(
        tx,
        request.principal!.tenantId,
        'REQUEST',
        request.principal!.id,
        request.id,
        {
          method: request.method,
          route: request.routeOptions.url ?? 'unmatched',
        },
      );
    });
  });
  app.setNotFoundHandler(() => {
    throw new DomainError(404, 'NOT_FOUND');
  });
  app.setErrorHandler(async (error, request, reply) => {
    const rawStatus =
      error instanceof Error && 'statusCode' in error
        ? Number(error.statusCode)
        : 503;
    let status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : [400, 413, 415, 429].includes(rawStatus)
            ? rawStatus
            : 503;
    let code =
      error instanceof DomainError
        ? error.code
        : status === 400 || status === 415
          ? 'INVALID_REQUEST'
          : status === 413
            ? 'PAYLOAD_TOO_LARGE'
            : status === 429
              ? 'RATE_LIMITED'
              : 'UNAVAILABLE';
    try {
      const p = request.principal;
      const t = p?.tenantId ?? SYSTEM_TENANT;
      await store.transaction(t, (tx) =>
        audit(
          tx,
          t,
          p ? 'REQUEST_REJECTED' : 'AUTHENTICATION_ERROR',
          p?.id ?? null,
          request.id,
          { code, route: request.routeOptions.url ?? 'unmatched' },
        ),
      );
    } catch {
      status = 503;
      code = 'UNAVAILABLE';
    }
    request.log.warn({ code, requestId: request.id }, 'Request rejected');
    return reply.code(status).send({
      error: {
        code,
        message: code.replaceAll('_', ' '),
        correlationId: request.id,
        retryable: status === 429 || code === 'UNAVAILABLE',
      },
    });
  });
  app.get('/internal/metrics', async (request, reply) => {
    requireRole(request.principal!, 'audit:read');
    return reply.type(registry.contentType).send(await registry.metrics());
  });
  if (options.surface === 'gateway') {
    if (!options.gateway) throw new Error('Gateway dependency required');
    app.post('/internal/v1/executions', async (request, reply) => {
      const input = executionSchema.parse(request.body);
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.raw.once('aborted', abort);
      const disconnect = () => {
        if (!reply.raw.writableFinished) abort();
      };
      reply.raw.once('close', disconnect);
      const timeout = setTimeout(abort, 10000);
      const span = spans.get(request);
      try {
        return await context.with(
          span ? trace.setSpan(context.active(), span) : context.active(),
          () =>
            options.gateway!.execute(
              request.principal!,
              input,
              request.id,
              controller.signal,
            ),
        );
      } finally {
        clearTimeout(timeout);
        request.raw.removeListener('aborted', abort);
        reply.raw.removeListener('close', disconnect);
      }
    });
    return app;
  }
  app.post('/v1/decisions/evaluate', async (request) =>
    authorization.evaluate(
      request.principal!,
      evaluationSchema.parse(request.body),
      request.id,
    ),
  );
  app.post('/v1/approvals/:approvalId/resolve', async (request) => {
    const { approvalId } = z
      .object({ approvalId: z.uuid() })
      .parse(request.params);
    return authorization.resolve(
      request.principal!,
      approvalId,
      resolutionSchema.parse(request.body),
      request.id,
      idempotency(request.headers),
    );
  });
  app.get('/v1/approvals', async (request) => {
    const p = request.principal!;
    requireRole(p, 'approval:read');
    const { cursor, limit, ...filters } = approvalQuery.parse(request.query);
    const after = cursors.decode(cursor, p.tenantId, 'approvals', filters);
    if (after) z.uuid().parse(after);
    return store.transaction(p.tenantId, async (tx) => {
      await authorization.expire(tx, p.tenantId, request.id);
      const result = await tx.query(
        `SELECT a.id FROM approvals a JOIN decisions d ON d.tenant_id=a.tenant_id AND d.id=a.decision_id WHERE a.tenant_id=$1 AND ($2::uuid IS NULL OR a.id>$2) AND ($3::text IS NULL OR a.state=$3) AND ($4::text IS NULL OR d.agent_id=$4) ORDER BY a.id LIMIT $5`,
        [
          p.tenantId,
          after ?? null,
          filters.status ?? null,
          filters.agentId ?? null,
          limit + 1,
        ],
      );
      const rows = result.rows.slice(0, limit);
      const items = [];
      for (const row of rows)
        items.push(await authorization.approvalView(tx, p, row.id));
      return {
        items,
        nextCursor:
          result.rows.length > limit
            ? cursors.encode(p.tenantId, 'approvals', filters, rows.at(-1)!.id)
            : null,
      };
    });
  });
  app.get('/v1/audit/events', async (request) => {
    const p = request.principal!;
    requireRole(p, 'audit:read');
    const { cursor, limit, ...filters } = auditQuery.parse(request.query);
    const after = cursors.decode(cursor, p.tenantId, 'audit', filters) ?? '-1';
    if (!/^-?\d{1,16}$/.test(after))
      throw new DomainError(400, 'INVALID_CURSOR');
    const result = await store.pool.query(
      `SELECT seq,event FROM api_audit_events WHERE tenant_id=$1 AND seq>$2 AND ($3::text IS NULL OR (event->>'occurredAt')::timestamptz>=$3::timestamptz) AND ($4::text IS NULL OR (event->>'occurredAt')::timestamptz<=$4::timestamptz) AND ($5::text IS NULL OR event->>'type'=$5) AND ($6::text IS NULL OR event->>'agentId'=$6) AND ($7::text IS NULL OR event->>'decisionId'=$7) ORDER BY seq LIMIT $8`,
      [
        p.tenantId,
        after,
        filters.from ?? null,
        filters.to ?? null,
        filters.type ?? null,
        filters.agentId ?? null,
        filters.decisionId ?? null,
        limit + 1,
      ],
    );
    const rows = result.rows.slice(0, limit);
    return {
      items: rows.map((row) => row.event),
      nextCursor:
        result.rows.length > limit
          ? cursors.encode(p.tenantId, 'audit', filters, rows.at(-1)!.seq)
          : null,
    };
  });
  app.get('/v1/policies', async (request) => {
    const p = request.principal!;
    requireRole(p, 'policy:read');
    const { cursor, limit } = policyQuery.parse(request.query);
    const after = cursors.decode(cursor, p.tenantId, 'policies', {}) ?? '';
    const result = await store.pool.query(
      `SELECT c.id AS "policyId",c.tenant_id AS "tenantId",c.name,c.description,c.active_version AS "activeVersion",c.latest_version AS "latestVersion",COALESCE(t.active_policy,'none') AS "tenantPolicyVersion",c.created_at AS "createdAt",c.updated_at AS "updatedAt" FROM policy_catalog c JOIN tenants t ON t.id=c.tenant_id WHERE c.tenant_id=$1 AND c.id>$2 ORDER BY c.id LIMIT $3`,
      [p.tenantId, after, limit + 1],
    );
    const items = result.rows.slice(0, limit);
    return {
      items,
      nextCursor:
        result.rows.length > limit
          ? cursors.encode(p.tenantId, 'policies', {}, items.at(-1)!.policyId)
          : null,
    };
  });
  app.post('/v1/policies', async (request, reply) =>
    reply
      .code(201)
      .send(
        await authorization.writePolicy(
          request.principal!,
          policyWriteSchema.parse(request.body),
          request.id,
          idempotency(request.headers),
        ),
      ),
  );
  return app;
}
