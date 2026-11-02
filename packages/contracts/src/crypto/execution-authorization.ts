import { randomUUID, sign, verify, type KeyObject } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import { canonicalJson } from '../canonical.js';
import { LIMITS } from '../limits.js';
import { ActionName, AgentId, Identifier, PrincipalId, ResourceKey, Sha256Digest, TenantId, Uuid } from '../primitives.js';
import { validate } from '../validate.js';

/*
 * Execution Authorization (EA) token — compact JWS (RFC 7515) with a fixed algorithm (EdDSA / Ed25519)
 * and a fixed type ("aegis-ea+jwt"). It is minted by the AEGIS decision service after an ALLOW and is
 * verified by a TRUSTED enforcement point (gateway or server-side tool adapter), never by the agent.
 *
 * Security properties:
 *  - algorithm pinned; "none", HMAC and RSA are rejected (no algorithm confusion);
 *  - kid must resolve to a configured public key;
 *  - lifetime capped (<= 300 s) and checked with bounded clock skew;
 *  - every binding (tenant, agent, principal, action, resource, arguments digest, audience) must match
 *    what the enforcement point is about to execute;
 *  - single use: the jti is consumed atomically in a replay store AFTER all other checks pass;
 *  - optional revocation hook (e.g. agent suspended after issuance).
 */

export const EA_TOKEN_TYPE = 'aegis-ea+jwt';
export const EA_ALGORITHM = 'EdDSA';

export const ExecutionAuthorizationClaims = Type.Object(
  {
    v: Type.Literal(1),
    iss: Identifier,
    aud: Identifier,
    jti: Uuid,
    tid: TenantId,
    sub: AgentId,
    prn: PrincipalId,
    act: ActionName,
    res: ResourceKey,
    args: Type.Union([Sha256Digest, Type.Null()]),
    // computeAttributesDigest(caller-claimed resource.attributes) — lets the gateway check claims against args.
    att: Sha256Digest,
    dec: Uuid,
    apr: Type.Union([Uuid, Type.Null()]),
    pv: Type.String({ minLength: 1, maxLength: 128 }),
    iat: Type.Integer({ minimum: 0 }),
    nbf: Type.Integer({ minimum: 0 }),
    exp: Type.Integer({ minimum: 0 }),
  },
  { $id: 'ExecutionAuthorizationClaims', additionalProperties: false },
);
export type ExecutionAuthorizationClaims = Static<typeof ExecutionAuthorizationClaims>;

const Header = Type.Object(
  {
    alg: Type.Literal(EA_ALGORITHM),
    typ: Type.Literal(EA_TOKEN_TYPE),
    kid: Identifier,
  },
  { additionalProperties: false },
);

export interface MintOptions {
  readonly privateKey: KeyObject;
  readonly kid: string;
  /** Issue time; defaults to the current time. Injected for deterministic tests. */
  readonly now?: Date;
  readonly lifetimeSeconds?: number;
  readonly jti?: string;
}

export type MintClaimsInput = Omit<ExecutionAuthorizationClaims, 'v' | 'jti' | 'iat' | 'nbf' | 'exp'>;

export function mintExecutionAuthorization(
  input: MintClaimsInput,
  options: MintOptions,
): { token: string; claims: ExecutionAuthorizationClaims } {
  const lifetime = options.lifetimeSeconds ?? 60;
  if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > LIMITS.executionAuthorizationMaxLifetimeSeconds) {
    throw new RangeError(`lifetimeSeconds must be an integer in [1, ${LIMITS.executionAuthorizationMaxLifetimeSeconds}]`);
  }
  if (options.privateKey.asymmetricKeyType !== 'ed25519' || options.privateKey.type !== 'private') {
    throw new TypeError('privateKey must be an Ed25519 private key');
  }
  const iat = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const claims: ExecutionAuthorizationClaims = {
    v: 1,
    ...input,
    jti: options.jti ?? randomUUID(),
    iat,
    nbf: iat,
    exp: iat + lifetime,
  };
  const checked = validate(ExecutionAuthorizationClaims, claims);
  if (!checked.ok) throw new TypeError(`invalid claims: ${checked.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
  const header = { alg: EA_ALGORITHM, typ: EA_TOKEN_TYPE, kid: options.kid };
  const signingInput = `${b64url(canonicalJson(header))}.${b64url(canonicalJson(claims))}`;
  const signature = sign(null, Buffer.from(signingInput, 'ascii'), options.privateKey);
  return { token: `${signingInput}.${signature.toString('base64url')}`, claims };
}

/** Atomic consume-once store. MUST be shared by every replica of an enforcement point. */
export interface ReplayStore {
  /**
   * Returns true if jti was not seen before and is now recorded until `expiresAtEpochSeconds`; false otherwise.
   * `nowEpochSeconds` is the verifier's clock: retention MUST be computed from it (e.g. Redis
   * `SET jti 1 NX EX (expiresAt - now)`), so the store can never forget a jti the verifier would still accept.
   */
  consume(jti: string, expiresAtEpochSeconds: number, nowEpochSeconds: number): boolean | Promise<boolean>;
}

export interface ExpectedExecution {
  readonly audience: string;
  readonly tenantId: string;
  readonly agentId: string;
  readonly action: string;
  readonly resource: { readonly type: string; readonly id: string };
  /** Digest recomputed by the enforcement point from the arguments it will actually execute. */
  readonly argumentsDigest: string | null;
  /** If set, the token must have been issued on behalf of this principal. */
  readonly principalId?: string;
  /**
   * computeAttributesDigest(attributes re-derived by the gateway from the actual arguments). Set it for any
   * tool whose policy depends on caller-claimed attributes; it proves the claims evaluated match the call.
   */
  readonly attributesDigest?: string;
}

export interface VerifyOptions {
  /** kid -> Ed25519 public key. */
  readonly keys: ReadonlyMap<string, KeyObject>;
  readonly expected: ExpectedExecution;
  readonly replayStore: ReplayStore;
  readonly now?: Date;
  readonly clockSkewSeconds?: number;
  readonly maxLifetimeSeconds?: number;
  /** Return true to reject a token whose subject/decision was revoked after issuance. */
  readonly isRevoked?: (claims: ExecutionAuthorizationClaims) => boolean | Promise<boolean>;
}

export type EaFailureReason =
  | 'MALFORMED'
  | 'UNSUPPORTED_HEADER'
  | 'UNKNOWN_KEY'
  | 'BAD_SIGNATURE'
  | 'INVALID_CLAIMS'
  | 'NOT_YET_VALID'
  | 'EXPIRED'
  | 'LIFETIME_TOO_LONG'
  | 'AUDIENCE_MISMATCH'
  | 'BINDING_MISMATCH'
  | 'REVOKED'
  | 'REPLAYED'
  | 'VERIFIER_ERROR';

export type EaVerification =
  | { readonly ok: true; readonly claims: ExecutionAuthorizationClaims }
  | { readonly ok: false; readonly reason: EaFailureReason; readonly field?: string };

const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** Verifies and (on success) consumes an execution authorization. Never throws; fails closed. */
export async function verifyExecutionAuthorization(token: unknown, options: VerifyOptions): Promise<EaVerification> {
  try {
    if (typeof token !== 'string' || token.length === 0 || token.length > LIMITS.executionAuthorizationTokenMaxLength) {
      return fail('MALFORMED');
    }
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every((p) => SEGMENT.test(p))) return fail('MALFORMED');
    const [h, p, s] = parts as [string, string, string];

    const header = decodeJsonSegment(h);
    if (header === undefined) return fail('MALFORMED');
    if (!validate(Header, header).ok) return fail('UNSUPPORTED_HEADER');
    const key = options.keys.get((header as { kid: string }).kid);
    if (!key || key.asymmetricKeyType !== 'ed25519' || key.type !== 'public') return fail('UNKNOWN_KEY');

    const signature = strictB64(s);
    if (!signature || signature.length !== 64) return fail('BAD_SIGNATURE');
    if (!verify(null, Buffer.from(`${h}.${p}`, 'ascii'), key, signature)) return fail('BAD_SIGNATURE');

    const payload = decodeJsonSegment(p);
    const checked = validate(ExecutionAuthorizationClaims, payload);
    if (!checked.ok) return fail('INVALID_CLAIMS');
    const claims = checked.value;

    const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
    const skew = options.clockSkewSeconds ?? 30;
    const maxLifetime = Math.min(
      options.maxLifetimeSeconds ?? LIMITS.executionAuthorizationMaxLifetimeSeconds,
      LIMITS.executionAuthorizationMaxLifetimeSeconds,
    );
    if (claims.exp <= claims.nbf || claims.nbf < claims.iat || claims.exp - claims.iat > maxLifetime) {
      return fail('LIFETIME_TOO_LONG');
    }
    if (now + skew < claims.nbf) return fail('NOT_YET_VALID');
    if (now - skew >= claims.exp) return fail('EXPIRED');

    const e = options.expected;
    if (claims.aud !== e.audience) return fail('AUDIENCE_MISMATCH');
    const mismatches: Array<[string, boolean]> = [
      ['tid', claims.tid === e.tenantId],
      ['sub', claims.sub === e.agentId],
      ['act', claims.act === e.action],
      ['res.type', claims.res.type === e.resource.type],
      ['res.id', claims.res.id === e.resource.id],
      ['args', claims.args === e.argumentsDigest],
      ['prn', e.principalId === undefined || claims.prn === e.principalId],
      ['att', e.attributesDigest === undefined || claims.att === e.attributesDigest],
    ];
    const bad = mismatches.find(([, ok]) => !ok);
    if (bad) return { ok: false, reason: 'BINDING_MISMATCH', field: bad[0] };

    if (options.isRevoked && (await options.isRevoked(claims))) return fail('REVOKED');
    // Consume last so that a token rejected for any other reason is not burned by an attacker probing it.
    if (!(await options.replayStore.consume(claims.jti, claims.exp + skew, now))) return fail('REPLAYED');
    return { ok: true, claims };
  } catch {
    return fail('VERIFIER_ERROR');
  }
}

function fail(reason: EaFailureReason): EaVerification {
  return { ok: false, reason };
}

function b64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

/** Decodes base64url and rejects non-canonical encodings (Node's decoder is lenient). */
function strictB64(segment: string): Buffer | undefined {
  const buf = Buffer.from(segment, 'base64url');
  return buf.toString('base64url') === segment ? buf : undefined;
}

function decodeJsonSegment(segment: string): unknown {
  const buf = strictB64(segment);
  if (!buf) return undefined;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Single-process replay store for tests and single-instance development only. Production enforcement
 * points MUST use a shared atomic store (e.g. Redis SET NX EX, or a unique-constrained DB row).
 */
export class InMemoryReplayStore implements ReplayStore {
  private readonly seen = new Map<string, number>();
  constructor(private readonly maxEntries = 100_000) {}

  consume(jti: string, expiresAtEpochSeconds: number, nowEpochSeconds: number): boolean {
    // Evict only by the verifier's clock: an entry is dropped once the verifier itself would reject its token.
    for (const [id, exp] of this.seen) if (exp < nowEpochSeconds) this.seen.delete(id);
    if (this.seen.has(jti)) return false;
    // Fail closed when full rather than evicting live entries (which would re-enable replay).
    if (this.seen.size >= this.maxEntries) return false;
    this.seen.set(jti, expiresAtEpochSeconds);
    return true;
  }
}
