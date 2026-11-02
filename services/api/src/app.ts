import Fastify, { LogController } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Counter, Histogram, Registry } from 'prom-client';
import {
  Authorization,
  policyWriteSchema,
  resolutionSchema,
} from './authorization.js';
import {
  DomainError,
  evaluationSchema,
  requireRole,
  type Principal,
} from './domain.js';
import { authenticateBearer, type IdentityConfig } from './identity.js';
import { audit, SYSTEM_TENANT } from './store.js';
import { executionSchema, type Gateway } from '../../gateway/src/gateway.js';

export interface AppOptions {
  authorization: Authorization;
  identity: IdentityConfig;
  gateway?: Gateway;
  surface?: 'api' | 'gateway';
  logger?: boolean;
}
declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}
const pageSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.uuid().optional(),
  })
  .strict();
const auditPageSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,17})$/)
      .default('0'),
  })
  .strict();
const policyPageSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(128).default(''),
  })
  .strict();
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
            req: (request) => ({ method: request.method }),
            res: (reply) => ({ statusCode: reply.statusCode }),
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
    help: 'HTTP requests by bounded route and status',
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
  app.decorateRequest('principal', null);
  void app.register(rateLimit, { max: 240, timeWindow: '1 minute' });
  app.addHook('onRequest', async (request, reply) => {
    starts.set(request, performance.now());
    reply
      .header('x-request-id', request.id)
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
  });
  app.get('/v1/health', async () => ({ status: 'ok' }));
  if (!options) return app;
  const { authorization, identity } = options;
  const store = authorization.store;
  app.get('/internal/ready', async (_request, reply) => {
    try {
      await store.pool.query(
        'SELECT 1 FROM schema_migrations WHERE version=$1',
        ['001'],
      );
      return { status: 'ready', policyEngine: authorization.engine.name };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  app.addHook('preHandler', async (request) => {
    if (
      request.routeOptions.url === '/v1/health' ||
      request.routeOptions.url === '/internal/ready'
    )
      return;
    request.principal = await authenticateBearer(
      request.headers.authorization,
      identity,
      store,
    );
    await store.rateLimit(request.principal);
    await store.transaction(request.principal.tenantId, (tx) =>
      audit(
        tx,
        request.principal!.tenantId,
        'REQUEST',
        request.principal!.id,
        request.id,
        {
          method: request.method,
          route: request.routeOptions.url ?? 'unmatched',
        },
      ),
    );
  });
  app.setErrorHandler(async (error, request, reply) => {
    let status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError ||
            (error instanceof Error &&
              'statusCode' in error &&
              error.statusCode === 400)
          ? 400
          : error instanceof Error &&
              'statusCode' in error &&
              error.statusCode === 429
            ? 429
            : 503;
    let code =
      error instanceof DomainError
        ? error.code
        : status === 400
          ? 'INVALID_REQUEST'
          : status === 429
            ? 'RATE_LIMITED'
            : 'SERVICE_UNAVAILABLE';
    try {
      const principal = request.principal;
      const tenantId = principal?.tenantId ?? SYSTEM_TENANT;
      await store.transaction(tenantId, (tx) =>
        audit(
          tx,
          tenantId,
          principal ? 'REQUEST_REJECTED' : 'AUTHENTICATION_ERROR',
          principal?.id ?? null,
          request.id,
          { code, route: request.routeOptions.url ?? 'unmatched' },
        ),
      );
    } catch {
      status = 503;
      code = 'AUDIT_UNAVAILABLE';
    }
    request.log.warn({ code, requestId: request.id }, 'Request rejected');
    return reply.code(status).send({ error: { code, requestId: request.id } });
  });
  app.get('/internal/metrics', async (request, reply) => {
    requireRole(request.principal!, 'audit:read');
    return reply.type(registry.contentType).send(await registry.metrics());
  });
  if (options.surface === 'gateway') {
    if (!options.gateway) throw new Error('Gateway dependency required');
    app.post('/internal/v1/executions', async (request) => {
      const input = executionSchema.parse(request.body);
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.raw.once('aborted', abort);
      // Server-side deadline also bounds requests after clients stop waiting.
      const timeout = setTimeout(abort, 10000);
      try {
        return await options.gateway!.execute(
          request.principal!,
          input,
          request.id,
          controller.signal,
        );
      } finally {
        clearTimeout(timeout);
        request.raw.removeListener('aborted', abort);
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
    );
  });
  app.get('/v1/approvals', async (request) => {
    const principal = request.principal!;
    requireRole(principal, 'approval:read');
    const page = pageSchema.parse(request.query);
    return store.transaction(principal.tenantId, async (tx) => {
      await authorization.expire(tx, principal.tenantId, request.id);
      const result = await tx.query(
        `SELECT id AS "approvalId",decision_id AS "decisionId",state,expires_at AS "expiresAt",required_role AS "requiredRole"
        FROM approvals WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3`,
        [principal.tenantId, page.cursor ?? null, page.limit + 1],
      );
      const items = result.rows.slice(0, page.limit);
      return {
        items,
        nextCursor:
          result.rows.length > page.limit ? items.at(-1)?.approvalId : null,
      };
    });
  });
  app.get('/v1/audit/events', async (request) => {
    const principal = request.principal!;
    requireRole(principal, 'audit:read');
    const page = auditPageSchema.parse(request.query);
    const result = await store.pool.query(
      'SELECT seq,event,previous_hash AS "previousHash",hash FROM audit_events WHERE tenant_id=$1 AND seq>$2 ORDER BY seq LIMIT $3',
      [principal.tenantId, page.cursor, page.limit + 1],
    );
    const items = result.rows.slice(0, page.limit);
    return {
      items,
      nextCursor: result.rows.length > page.limit ? items.at(-1)?.seq : null,
    };
  });
  app.get('/v1/policies', async (request) => {
    const principal = request.principal!;
    requireRole(principal, 'policy:read');
    const page = policyPageSchema.parse(request.query);
    const result = await store.pool.query(
      'SELECT p.version,p.document,p.digest,p.created_at AS "createdAt",(p.version=t.active_policy) AS active FROM policies p JOIN tenants t ON t.id=p.tenant_id WHERE p.tenant_id=$1 AND p.version>$2 ORDER BY p.version LIMIT $3',
      [principal.tenantId, page.cursor, page.limit + 1],
    );
    const items = result.rows.slice(0, page.limit);
    return {
      items,
      nextCursor:
        result.rows.length > page.limit ? items.at(-1)?.version : null,
    };
  });
  app.post('/v1/policies', async (request) =>
    authorization.writePolicy(
      request.principal!,
      policyWriteSchema.parse(request.body),
      request.id,
    ),
  );
  return app;
}
