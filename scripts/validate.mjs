#!/usr/bin/env node
// Validate dist/catalog.json against schema/catalog.schema.json (structural) and
// a set of invariants that a JSON Schema can't easily express. Exits non-zero on
// any violation so CI blocks bad data from being published.
//
// Zero-dependency: a small structural check plus explicit invariants. (If you
// later want full JSON Schema, swap the structural pass for ajv.)

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...x) => resolve(ROOT, ...x);
const readJson = async (rel) => JSON.parse(await readFile(p(rel), 'utf8'));

const errors = [];
const fail = (msg) => errors.push(msg);

function checkTopLevel(cat) {
  for (const key of ['version', 'generated_at', 'upstream', 'models', 'clients']) {
    if (!(key in cat)) fail(`missing top-level key: ${key}`);
  }
  if (cat.models && typeof cat.models !== 'object') fail('models must be an object');
  if (cat.clients && typeof cat.clients !== 'object') fail('clients must be an object');
}

function checkModels(models) {
  const VALID_SOURCE = new Set(['litellm', 'patch']);
  let count = 0;
  for (const [id, m] of Object.entries(models)) {
    count++;
    if (!m.provider) fail(`${id}: empty provider`);
    if (!m.platform) fail(`${id}: empty platform`);
    if (!VALID_SOURCE.has(m.source)) fail(`${id}: invalid source "${m.source}"`);
    for (const costKey of [
      'input_cost_per_token',
      'output_cost_per_token',
      'cache_read_input_token_cost',
      'cache_creation_input_token_cost',
    ]) {
      if (costKey in m) {
        if (typeof m[costKey] !== 'number') fail(`${id}: ${costKey} must be a number`);
        else if (m[costKey] < 0) fail(`${id}: ${costKey} is negative (${m[costKey]})`);
        else if (m[costKey] > 1) fail(`${id}: ${costKey}=${m[costKey]} > 1 USD/token — likely a per-million vs per-token unit error`);
      }
    }
    for (const tokKey of ['max_input_tokens', 'max_output_tokens']) {
      if (tokKey in m && (!Number.isInteger(m[tokKey]) || m[tokKey] <= 0)) {
        fail(`${id}: ${tokKey} must be a positive integer (got ${m[tokKey]})`);
      }
    }
    if (m.capabilities && typeof m.capabilities !== 'object') fail(`${id}: capabilities must be an object`);
  }
  if (count === 0) fail('catalog has zero models — upstream sync likely failed');
  return count;
}

function checkClients(clients) {
  for (const [name, c] of Object.entries(clients)) {
    if (!Array.isArray(c.models)) fail(`client ${name}: models must be an array`);
    else {
      if (c.models.length === 0) fail(`client ${name}: empty models list`);
      const dupes = c.models.filter((v, i) => c.models.indexOf(v) !== i);
      if (dupes.length) fail(`client ${name}: duplicate models ${[...new Set(dupes)].join(', ')}`);
    }
  }
}

async function main() {
  let catalog;
  try {
    catalog = await readJson('dist/catalog.json');
  } catch (err) {
    console.error(`validate: cannot read dist/catalog.json — run "npm run build" first (${err.message})`);
    process.exit(1);
  }

  checkTopLevel(catalog);
  const modelCount = catalog.models ? checkModels(catalog.models) : 0;
  if (catalog.clients) checkClients(catalog.clients);

  if (errors.length) {
    console.error(`validate: FAILED with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`validate: OK — ${modelCount} models, ${Object.keys(catalog.clients || {}).length} clients, version ${catalog.version}`);
}

main().catch((err) => {
  console.error(`validate crashed: ${err.stack || err.message}`);
  process.exit(1);
});
