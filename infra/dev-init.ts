import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
const directory = new URL('../.backend-tmp/dev/', import.meta.url);
await mkdir(directory, { recursive: true });
const envPath = new URL('../.backend-tmp/compose.env', import.meta.url);
try {
  await readFile(envPath);
  console.log('Local configuration already exists; credentials retained.');
} catch (error) {
  if (
    !(error instanceof Error) ||
    !('code' in error) ||
    error.code !== 'ENOENT'
  )
    throw error;
  const keys = await generateKeyPair('RS256', {
    extractable: true,
    modulusLength: 3072,
  });
  await writeFile(
    new URL('public.pem', directory),
    await exportSPKI(keys.publicKey),
    { mode: 0o644 },
  );
  await writeFile(
    new URL('private.pem', directory),
    await exportPKCS8(keys.privateKey),
    { mode: 0o600 },
  );
  const secret = () => randomBytes(32).toString('hex');
  await writeFile(
    envPath,
    `POSTGRES_PASSWORD=${secret()}\nAEGIS_APP_DB_PASSWORD=${secret()}\nAEGIS_DEMO_DB_PASSWORD=${secret()}\nDEMO_TOOL_SECRET=${secret()}\nCURSOR_SIGNING_KEY=${secret()}\n`,
    { mode: 0o600 },
  );
  console.log(
    'Generated local-only credentials in ignored .backend-tmp; no tokens or secrets printed.',
  );
}
