#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const baseIndex = args.indexOf('--base');
const base = baseIndex >= 0 ? args[baseIndex + 1] : 'HEAD';

if (!base || args.includes('--help')) {
  console.log('Usage: audit-upstream-delta.mjs [--base <git-ref>] [--json]');
  process.exit(base ? 0 : 1);
}

const readJson = async (path) => JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));
const stripDocKeys = (value) => Object.fromEntries(
  Object.entries(value || {}).filter(([key]) => !key.startsWith('_')),
);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const valueType = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

function readBaseUpstream() {
  try {
    return JSON.parse(execFileSync(
      'git',
      ['show', `${base}:upstream/litellm/prices.json`],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 },
    ));
  } catch (error) {
    console.error(`audit-upstream-delta: cannot read base ${base}: ${error.message}`);
    process.exit(1);
  }
}

function resolvePlatform(modelId, provider, providers) {
  for (const [prefix, platform] of Object.entries(providers.byModelPrefix || {})) {
    if (!prefix.startsWith('_') && modelId.startsWith(prefix)) return platform;
  }
  if (provider && providers.byProvider?.[provider]) return providers.byProvider[provider];
  const prefixes = Object.entries(providers.byProviderPrefix || {})
    .filter(([prefix]) => !prefix.startsWith('_'))
    .sort((left, right) => right[0].length - left[0].length);
  for (const [prefix, platform] of prefixes) {
    if (provider && provider.startsWith(prefix)) return platform;
  }
  return provider || 'unknown';
}

function normalizedValue(modelId, upstream, field, providers) {
  const provider = upstream.litellm_provider || (modelId.includes('/') ? modelId.split('/')[0] : 'unknown');
  if (field === 'provider') return provider;
  if (field === 'platform') return resolvePlatform(modelId, provider, providers);
  if (field === 'max_input_tokens') return upstream.max_input_tokens ?? upstream.max_tokens;
  return upstream[field];
}

function redundantPricingCandidates(current, pricingPatches, providers) {
  const candidates = [];
  for (const [modelId, patchWithNotes] of Object.entries(pricingPatches)) {
    const upstream = current[modelId];
    if (!upstream || modelId.startsWith('_')) continue;
    const patch = stripDocKeys(patchWithNotes);
    const fields = Object.keys(patch);
    if (fields.length && fields.every((field) => same(patch[field], normalizedValue(modelId, upstream, field, providers)))) {
      candidates.push(modelId);
    }
  }
  return candidates.sort();
}

function redundantCapabilityCandidates(current, capabilityPatches) {
  const candidates = [];
  for (const [modelId, patchWithNotes] of Object.entries(capabilityPatches)) {
    const upstream = current[modelId];
    if (!upstream || modelId.startsWith('_')) continue;
    const patch = stripDocKeys(patchWithNotes);
    const fields = Object.keys(patch);
    const rawKey = (field) => field === 'thinking_always_on' ? field : `supports_${field}`;
    if (fields.length && fields.every((field) => same(patch[field], upstream[rawKey(field)]))) {
      candidates.push(modelId);
    }
  }
  return candidates.sort();
}

function summarizeAdded(current, added) {
  const byProvider = {};
  const byMode = {};
  for (const modelId of added) {
    const record = current[modelId] || {};
    const provider = record.litellm_provider || (modelId.includes('/') ? modelId.split('/')[0] : 'unknown');
    const mode = record.mode || 'unknown';
    byProvider[provider] = (byProvider[provider] || 0) + 1;
    byMode[mode] = (byMode[mode] || 0) + 1;
  }
  return { byProvider, byMode };
}

const previous = readBaseUpstream();
const [current, pricingPatches, capabilityPatches, providers, clientNames] = await Promise.all([
  readJson('upstream/litellm/prices.json'),
  readJson('patches/pricing.json'),
  readJson('patches/capabilities.json'),
  readJson('patches/providers.json'),
  readdir(resolve(ROOT, 'clients')),
]);

const clients = [];
for (const file of clientNames.filter((name) => name.endsWith('.json')).sort()) {
  clients.push(await readJson(`clients/${file}`));
}

const previousIds = new Set(Object.keys(previous));
const currentIds = new Set(Object.keys(current));
const added = [...currentIds].filter((id) => !previousIds.has(id)).sort();
const removed = [...previousIds].filter((id) => !currentIds.has(id)).sort();
const changed = [...currentIds]
  .filter((id) => previousIds.has(id) && !same(previous[id], current[id]))
  .sort();

const previousFields = new Set(Object.values(previous).flatMap((record) =>
  record && typeof record === 'object' ? Object.keys(record) : [],
));
const newFieldMap = new Map();
for (const [modelId, record] of Object.entries(current)) {
  if (!record || typeof record !== 'object') continue;
  for (const [field, value] of Object.entries(record)) {
    if (previousFields.has(field)) continue;
    const item = newFieldMap.get(field) || { count: 0, types: new Set(), examples: [] };
    item.count += 1;
    item.types.add(valueType(value));
    if (item.examples.length < 5) item.examples.push(modelId);
    newFieldMap.set(field, item);
  }
}

const typeChanges = [];
for (const modelId of changed) {
  const before = previous[modelId];
  const after = current[modelId];
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') continue;
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!(field in before) || !(field in after)) continue;
    const beforeType = valueType(before[field]);
    const afterType = valueType(after[field]);
    if (beforeType !== afterType) typeChanges.push({ modelId, field, beforeType, afterType });
  }
}

const patchIds = new Set([
  ...Object.keys(stripDocKeys(pricingPatches)),
  ...Object.keys(stripDocKeys(capabilityPatches)),
]);
const changedPatchedModels = changed.filter((id) => patchIds.has(id));
const pricingPatchIds = new Set(Object.keys(stripDocKeys(pricingPatches)));
const removedClientReferences = [];
const missingClientReferences = [];
for (const client of clients) {
  for (const modelId of client.models || []) {
    if (removed.includes(modelId)) removedClientReferences.push({ client: client.client, modelId });
    if (!currentIds.has(modelId) && !pricingPatchIds.has(modelId)) {
      missingClientReferences.push({ client: client.client, modelId });
    }
  }
}

const result = {
  base,
  counts: {
    previous: previousIds.size,
    current: currentIds.size,
    added: added.length,
    removed: removed.length,
    changed: changed.length,
  },
  added,
  removed,
  changed,
  addedSummary: summarizeAdded(current, added),
  newFields: Object.fromEntries([...newFieldMap.entries()].sort().map(([field, item]) => [field, {
    count: item.count,
    types: [...item.types].sort(),
    examples: item.examples,
  }])),
  typeChanges,
  changedPatchedModels,
  redundantPatchCandidates: {
    pricing: redundantPricingCandidates(current, pricingPatches, providers),
    capabilities: redundantCapabilityCandidates(current, capabilityPatches),
  },
  removedClientReferences,
  missingClientReferences,
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`LiteLLM delta from ${base}: ${result.counts.previous} -> ${result.counts.current}`);
  console.log(`  added=${result.counts.added} removed=${result.counts.removed} changed=${result.counts.changed}`);
  console.log(`  added by provider: ${JSON.stringify(result.addedSummary.byProvider)}`);
  console.log(`  added by mode: ${JSON.stringify(result.addedSummary.byMode)}`);
  console.log(`  new fields: ${Object.keys(result.newFields).length ? Object.entries(result.newFields).map(([key, value]) => `${key}(${value.count})`).join(', ') : 'none'}`);
  console.log(`  field type changes: ${result.typeChanges.length}`);
  console.log(`  patched models changed upstream: ${changedPatchedModels.length ? changedPatchedModels.join(', ') : 'none'}`);
  console.log(`  redundant pricing patch candidates: ${result.redundantPatchCandidates.pricing.length ? result.redundantPatchCandidates.pricing.join(', ') : 'none'}`);
  console.log(`  redundant capability patch candidates: ${result.redundantPatchCandidates.capabilities.length ? result.redundantPatchCandidates.capabilities.join(', ') : 'none'}`);
  console.log(`  removed models still referenced by clients: ${removedClientReferences.length ? JSON.stringify(removedClientReferences) : 'none'}`);
  console.log(`  client references missing from upstream and pricing patches: ${missingClientReferences.length ? JSON.stringify(missingClientReferences) : 'none'}`);
  if (Object.keys(result.newFields).length) {
    console.log('Review every new field for build/schema distribution coverage; presence here is an alert, not proof it belongs in dist.');
  }
}
