import {
  createRemoteJWKSet,
  importSPKI,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import type { Store } from './store.js';
import { DomainError } from './domain.js';

export interface IdentityConfig {
  issuer: string;
  audience: string;
  key: Awaited<ReturnType<typeof importSPKI>> | JWTVerifyGetKey;
}
export async function authenticateBearer(
  header: string | undefined,
  config: IdentityConfig,
  store: Store,
) {
  if (!header?.startsWith('Bearer ') || header.length > 16384)
    throw new DomainError(401, 'INVALID_CREDENTIALS');
  try {
    const { payload } = await jwtVerify(header.slice(7), config.key, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'iss', 'aud', 'exp', 'iat'],
      clockTolerance: 0,
    });
    if (
      !payload.sub ||
      !payload.iss ||
      typeof payload.iat !== 'number' ||
      payload.iat > Math.floor(Date.now() / 1000)
    )
      throw new Error('Invalid claims');
    // Tenant, roles and permissions in JWTs are deliberately ignored.
    return await store.authenticate(payload.iss, payload.sub);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(401, 'INVALID_CREDENTIALS');
  }
}
export async function identityFromEnv(): Promise<IdentityConfig> {
  const issuer = process.env.JWT_ISSUER;
  const audience = process.env.JWT_AUDIENCE;
  if (!issuer || !audience)
    throw new Error('JWT_ISSUER and JWT_AUDIENCE required');
  if (process.env.JWT_PUBLIC_KEY_FILE) {
    const { readFile } = await import('node:fs/promises');
    return {
      issuer,
      audience,
      key: await importSPKI(
        await readFile(process.env.JWT_PUBLIC_KEY_FILE, 'utf8'),
        'RS256',
      ),
    };
  }
  const url = new URL(process.env.JWT_JWKS_URL ?? '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error('HTTPS JWKS URL required');
  return {
    issuer,
    audience,
    key: createRemoteJWKSet(url, {
      timeoutDuration: 2000,
      cooldownDuration: 30000,
      cacheMaxAge: 60000,
    }),
  };
}
