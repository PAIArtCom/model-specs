#!/usr/bin/env node
// Validate dist/catalog.json against schema/catalog.schema.json (structural + bounds),
// then apply semantic invariants that JSON Schema can't easily express.
// Exits non-zero on any violation so CI blocks bad data from being published.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...x) => resolve(ROOT, ...x);
const readJson = async (rel) => JSON.parse(await readFile(p(rel), 'utf8'));

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// Derive cost field names from the schema so this list never drifts from the
// schema definition — adding a field to schema/catalog.schema.json automatically
// includes it in the unit-error check below.
function costFieldsFromSchema(schema) {
  const modelProps = schema?.properties?.models?.additionalProperties?.properties ?? {};
  return Object.keys(modelProps).filter((k) => k.includes('cost'));
}

function checkSemanticInvariants(catalog, schema) {
  const { models = {}, clients = {} } = catalog;

  // Schema enforces minProperties:1 on models, but we emit a clearer message
  // since an empty upstream/ sync is a deployment-breaking failure.
  if (Object.keys(models).length === 0) {
    fail('catalog has zero models — upstream sync likely failed');
  }

  // Schema enforces maximum:1 on cost fields, but the bare "must be <= 1" message
  // is cryptic. Two diagnostic tiers, applied only to per-TOKEN fields (non-token
  // fields like per_image / per_second / per_query have different value scales):
  //   > 1     → hard fail  (schema also catches this; message is more actionable)
  //   > 0.001 → warning    (> $1,000/M tokens — almost certainly a per-million unit
  //                          error; kept as warn so upstream noise doesn't block CI)
  const costKeys = costFieldsFromSchema(schema);
  const tokenCostKeys = costKeys.filter((k) => k.includes('_token'));
  for (const [id, m] of Object.entries(models)) {
    for (const costKey of costKeys) {
      const v = m[costKey];
      if (typeof v !== 'number') continue;
      if (v > 1) {
        fail(`${id}: ${costKey}=${v} > 1 USD/token — likely a per-million vs per-token unit error`);
      }
    }
    for (const costKey of tokenCostKeys) {
      const v = m[costKey];
      if (typeof v === 'number' && v > 0.001) {
        warn(`${id}: ${costKey}=${v} > $1,000/M tokens — verify this is not a per-million unit error`);
      }
    }
  }

  // Warn when a client references a model id not in the catalog. clients/ is
  // intentionally allowed to list ids LiteLLM doesn't track yet, so this is a
  // signal rather than a hard error — it prompts a pricing-patch or upstream update.
  for (const [clientName, c] of Object.entries(clients)) {
    for (const modelId of c.models ?? []) {
      if (!models[modelId]) {
        warn(`client ${clientName}: model "${modelId}" has no catalog entry (no pricing/context data)`);
      }
    }
  }
}

async function main() {
  let catalog, schema;
  try {
    catalog = await readJson('dist/catalog.json');
  } catch (err) {
    console.error(`validate: cannot read dist/catalog.json — run "npm run build" first (${err.message})`);
    process.exit(1);
  }
  try {
    schema = await readJson('schema/catalog.schema.json');
  } catch (err) {
    console.error(`validate: cannot read schema/catalog.schema.json (${err.message})`);
    process.exit(1);
  }

  // Schema validation: structural correctness, required fields, type constraints,
  // cost bounds (0 ≤ cost ≤ 1), token limits (positive integers), unique client models.
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const valid = ajv.validate(schema, catalog);
  if (!valid) {
    for (const err of ajv.errors) {
      fail(`schema: ${err.instancePath || '(root)'} ${err.message}`);
    }
  }

  // Semantic invariants beyond what JSON Schema expresses.
  checkSemanticInvariants(catalog, schema);

  if (warnings.length) {
    for (const w of warnings) console.warn(`  warn: ${w}`);
  }

  if (errors.length) {
    console.error(`validate: FAILED with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const modelCount = Object.keys(catalog.models || {}).length;
  const clientCount = Object.keys(catalog.clients || {}).length;
  const warnSuffix = warnings.length ? `, ${warnings.length} warning(s)` : '';
  console.log(`validate: OK — ${modelCount} models, ${clientCount} clients, version ${catalog.version}${warnSuffix}`);
}

main().catch((err) => {
  console.error(`validate crashed: ${err.stack || err.message}`);
  process.exit(1);
});
