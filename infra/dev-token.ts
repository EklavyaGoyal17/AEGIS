// Prints a short-lived local bearer token for a seeded principal, for curl experiments against the local
// stack only. Usage: npm run dev:token -- demo-machine   (or demo-human)
import { readFile } from 'node:fs/promises';
import { importPKCS8, SignJWT } from 'jose';

if (process.env.NODE_ENV === 'production')
  throw new Error('dev:token is disabled in production');
const subject = process.argv[2];
if (subject !== 'demo-machine' && subject !== 'demo-human')
  throw new Error('Usage: npm run dev:token -- <demo-machine|demo-human>');
const key = await importPKCS8(
  await readFile(
    new URL('../.backend-tmp/dev/private.pem', import.meta.url),
    'utf8',
  ),
  'RS256',
);
const token = await new SignJWT({})
  .setProtectedHeader({ alg: 'RS256' })
  .setIssuer('https://identity.aegis.local.invalid')
  .setAudience('aegis-local')
  .setSubject(subject)
  .setIssuedAt()
  .setExpirationTime('5m')
  .sign(key);
process.stdout.write(`${token}\n`);
