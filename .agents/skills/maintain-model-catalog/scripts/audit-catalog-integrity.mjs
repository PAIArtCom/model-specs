#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const jsonOutput = process.argv.includes('--json');
if (process.argv.includes('--help')) {
  console.log('Usage: audit-catalog-integrity.mjs [--json]');
  process.exit(0);
}

const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);
const readText = async (path) => readFile(resolve(ROOT, path), 'utf8');
const readJson = async (path) => JSON.parse(await readText(path));
const stripDocKeys = (value) => Object.fromEntries(
  Object.entries(value || {}).filter(([key]) => !key.startsWith('_')),
);

const [upstreamText, sourceText, upstream, pricingPatchesRaw, capabilityPatchesRaw, schema, buildSource, catalog, catalogSha, clientFiles] = await Promise.all([
  readText('upstream/litellm/prices.json'),
  readText('upstream/litellm/SOURCE_SHA'),
  readJson('upstream/litellm/prices.json'),
  readJson('patches/pricing.json'),
  readJson('patches/capabilities.json'),
  readJson('schema/catalog.schema.json'),
  readText('scripts/build.mjs'),
  readJson('dist/catalog.json'),
  readText('dist/catalog.sha'),
  readdir(resolve(ROOT, 'clients')),
]);

const provenance = Object.fromEntries(sourceText.split('\n')
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
const contentHash = createHash('sha256').update(upstreamText).digest('hex');
if (!/^[0-9a-f]{40}$/.test(provenance.commit || '')) fail('SOURCE_SHA must contain a pinned 40-character commit');
if (!provenance.source?.includes(provenance.commit || '__missing__')) fail('SOURCE_SHA source URL does not contain its pinned commit');
if (provenance.content_sha256 !== contentHash) fail('SOURCE_SHA content_sha256 does not match upstream/litellm/prices.json');

const pricingPatches = stripDocKeys(pricingPatchesRaw);
const capabilityPatches = stripDocKeys(capabilityPatchesRaw);
for (const [kind, patches] of [['pricing', pricingPatches], ['capability', capabilityPatches]]) {
  for (const [modelId, patch] of Object.entries(patches)) {
    const note = patch?._note;
    if (typeof note !== 'string' || !/https?:\/\//.test(note) || !/\(\d{4}-\d{2}-\d{2}/.test(note)) {
      fail(`${kind} patch ${modelId} lacks a source URL and YYYY-MM-DD verification date`);
    }
  }
}

for (const [modelId, patch] of Object.entries(pricingPatches)) {
  if (upstream[modelId]) continue;
  for (const field of ['provider', 'platform', 'mode']) {
    if (typeof patch[field] !== 'string' || !patch[field]) fail(`patch-only model ${modelId} lacks ${field}`);
  }
}
for (const modelId of Object.keys(capabilityPatches)) {
  if (!upstream[modelId] && !pricingPatches[modelId]) fail(`capability patch ${modelId} has no upstream or pricing base record`);
}

const clientNames = [];
const missingClientReferences = [];
for (const file of clientFiles.filter((name) => name.endsWith('.json')).sort()) {
  const client = await readJson(`clients/${file}`);
  const fileName = file.slice(0, -'.json'.length);
  clientNames.push(fileName);
  if (client.client !== fileName) fail(`clients/${file}: client must equal ${fileName}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(client.updated || '')) fail(`clients/${file}: updated must be YYYY-MM-DD`);
  if (!Array.isArray(client.models) || !client.models.length) fail(`clients/${file}: models must be a non-empty array`);
  if (new Set(client.models || []).size !== (client.models || []).length) fail(`clients/${file}: duplicate model IDs`);
  for (const modelId of client.models || []) {
    if (!upstream[modelId] && !pricingPatches[modelId]) missingClientReferences.push({ client: client.client, modelId });
  }
}

const clientLoop = buildSource.match(/for\s*\(const name of \[([^\]]+)\]\)/s)?.[1] || '';
const builtClients = new Set([...clientLoop.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]));
for (const clientName of clientNames) {
  if (!builtClients.has(clientName)) fail(`clients/${clientName}.json is not included by scripts/build.mjs`);
}
for (const clientName of builtClients) {
  if (!clientNames.includes(clientName)) fail(`scripts/build.mjs references missing clients/${clientName}.json`);
}

const modelProperties = schema?.properties?.models?.additionalProperties?.properties || {};
const schemaModes = new Set(modelProperties.mode?.enum || []);
const upstreamModes = new Set(Object.entries(upstream)
  .filter(([modelId, record]) => modelId !== 'sample_spec' && !modelId.startsWith('_') && record && typeof record === 'object')
  .map(([, record]) => record.mode || 'unknown'));
for (const mode of upstreamModes) if (!schemaModes.has(mode)) fail(`upstream mode ${mode} is not accepted by the catalog schema`);

const mappedRawFields = new Set([...buildSource.matchAll(/raw\.([A-Za-z0-9_]+)/g)].map((match) => match[1]));
const pricingLike = (field) => field.includes('cost') || field.includes('price') || field.includes('uplift_multiplier');
for (const field of mappedRawFields) {
  if (pricingLike(field) && !modelProperties[field]) fail(`scripts/build.mjs maps ${field}, but the schema does not declare it`);
}
for (const field of Object.keys(modelProperties)) {
  if (pricingLike(field) && !mappedRawFields.has(field)) warn(`schema declares ${field}, but scripts/build.mjs does not read it directly`);
}

const capBlock = buildSource.match(/const CAP_MAP = \{([\s\S]*?)\n\};/)?.[1] || '';
const mappedCapabilities = new Set([...capBlock.matchAll(/:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]));
for (const [modelId, patch] of Object.entries(capabilityPatches)) {
  for (const field of Object.keys(patch).filter((key) => !key.startsWith('_'))) {
    if (!mappedCapabilities.has(field)) fail(`capability patch ${modelId}.${field} is not recognized by CAP_MAP`);
  }
}

const expectedVersion = createHash('sha256')
  .update(JSON.stringify({ models: catalog.models, clients: catalog.clients }))
  .digest('hex')
  .slice(0, 12);
if (catalog.version !== expectedVersion) fail(`catalog version ${catalog.version} does not match payload hash ${expectedVersion}`);
if (catalogSha.trim() !== catalog.version) fail('dist/catalog.sha does not match dist/catalog.json version');
if (catalog.upstream?.sha !== provenance.commit) fail('dist upstream SHA does not match SOURCE_SHA');
if (Object.keys(catalog.clients || {}).length !== clientNames.length) fail('dist client count does not match clients/*.json');

if (missingClientReferences.length) {
  warn(`client references missing from upstream and pricing patches: ${JSON.stringify(missingClientReferences)}`);
}

const result = {
  ok: errors.length === 0,
  errors,
  warnings,
  summary: {
    upstreamModels: Object.keys(upstream).length,
    catalogModels: Object.keys(catalog.models || {}).length,
    clients: clientNames.length,
    pricingPatches: Object.keys(pricingPatches).length,
    capabilityPatches: Object.keys(capabilityPatches).length,
    catalogVersion: catalog.version,
    upstreamCommit: provenance.commit,
  },
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const message of warnings) console.warn(`warn: ${message}`);
  for (const message of errors) console.error(`error: ${message}`);
  console.log(`audit-catalog-integrity: ${result.ok ? 'OK' : 'FAILED'} — ${result.summary.catalogModels} catalog models, ${result.summary.clients} clients, ${errors.length} error(s), ${warnings.length} warning(s)`);
}

if (errors.length) process.exit(1);
