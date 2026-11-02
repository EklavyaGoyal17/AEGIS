// Generates openapi/aegis-v1.yaml and schemas/aegis-v1.schema.json from the compiled contract sources.
// Usage: node scripts/generate.mjs [--check]   (--check fails if committed files are stale)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { buildJsonSchemaBundle, buildOpenApi } from '../dist/index.js';

const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');

const examples = {};
for (const file of readdirSync(new URL('examples/', root)).sort()) {
  if (file.endsWith('.json')) {
    examples[file.slice(0, -5)] = JSON.parse(readFileSync(new URL(`examples/${file}`, root), 'utf8'));
  }
}

const header = '# GENERATED FILE - DO NOT EDIT. Source: packages/contracts/src. Regenerate: npm run generate\n';
const outputs = [
  ['openapi/aegis-v1.yaml', header + stringify(buildOpenApi(examples), { lineWidth: 0, aliasDuplicateObjects: false })],
  ['schemas/aegis-v1.schema.json', JSON.stringify(buildJsonSchemaBundle(), null, 2) + '\n'],
];

let stale = false;
for (const [path, content] of outputs) {
  const url = new URL(path, root);
  if (check) {
    let current = '';
    try {
      current = readFileSync(url, 'utf8').replace(/\r\n/g, '\n');
    } catch {
      // missing file is stale
    }
    if (current !== content) {
      console.error(`stale: ${path} (run npm run generate)`);
      stale = true;
    }
  } else {
    writeFileSync(url, content);
    console.log(`wrote ${path}`);
  }
}
if (stale) process.exit(1);
