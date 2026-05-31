#!/usr/bin/env node
// Merge: upstream/litellm (base) + patches/ (corrections) + clients/ (CLI lists)
// -> dist/catalog.json + dist/catalog.sha
//
// Deterministic and reproducible: same inputs always produce the same output
// (sorted keys, content-hash version). `upstream/` is read-only here.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...x) => resolve(ROOT, ...x);

const readJson = async (rel) => JSON.parse(await readFile(p(rel), 'utf8'));
const stripDocKeys = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('_')));

// LiteLLM capability flags -> our normalized capability keys.
const CAP_MAP = {
  // Core
  supports_function_calling: 'function_calling',
  supports_vision: 'vision',
  supports_prompt_caching: 'prompt_caching',
  supports_reasoning: 'reasoning',
  supports_response_schema: 'response_schema',
  supports_web_search: 'web_search',
  // Audio
  supports_audio_input: 'audio_input',
  supports_audio_output: 'audio_output',
  // Extended
  supports_tool_choice: 'tool_choice',
  supports_system_messages: 'system_messages',
  supports_parallel_function_calling: 'parallel_function_calling',
  supports_pdf_input: 'pdf_input',
  supports_computer_use: 'computer_use',
  supports_native_structured_output: 'native_structured_output',
  supports_video_input: 'video_input',
};

function resolvePlatform(modelId, provider, providers) {
  for (const [prefix, platform] of Object.entries(providers.byModelPrefix || {})) {
    if (prefix.startsWith('_')) continue;
    if (modelId.startsWith(prefix)) return platform;
  }
  if (provider && providers.byProvider?.[provider]) return providers.byProvider[provider];
  // Longest-prefix wins so vertex_ai-anthropic beats vertex_ai-.
  const prefixes = Object.entries(providers.byProviderPrefix || {})
    .filter(([k]) => !k.startsWith('_'))
    .sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, platform] of prefixes) {
    if (provider && provider.startsWith(prefix)) return platform;
  }
  return provider || 'unknown';
}

function normalizeModel(modelId, raw, providers) {
  // LiteLLM sometimes omits litellm_provider (e.g. zai/glm-*). Fall back to the
  // "provider/model" id prefix, then to "unknown", so every model has a provider.
  let provider = raw.litellm_provider || '';
  if (!provider) provider = modelId.includes('/') ? modelId.split('/')[0] : 'unknown';
  const capabilities = {};
  for (const [litellmKey, ourKey] of Object.entries(CAP_MAP)) {
    if (raw[litellmKey] === true) capabilities[ourKey] = true;
  }
  // numCost: preserves 0 (explicitly free/local models) — use for all pricing fields.
  // numPositive: requires > 0 — use for limits and sizes where 0 is meaningless.
  const numCost = (v) => (typeof v === 'number' && v >= 0 ? v : undefined);
  const numPositive = (v) => (typeof v === 'number' && v > 0 ? v : undefined);
  const model = {
    provider,
    platform: resolvePlatform(modelId, provider, providers),
    mode: raw.mode || 'unknown',
    // Token-based pricing (chat / completion models)
    input_cost_per_token: numCost(raw.input_cost_per_token),
    output_cost_per_token: numCost(raw.output_cost_per_token),
    cache_read_input_token_cost: numCost(raw.cache_read_input_token_cost),
    cache_creation_input_token_cost: numCost(raw.cache_creation_input_token_cost),
    cache_creation_input_token_cost_above_1hr: numCost(raw.cache_creation_input_token_cost_above_1hr),
    input_cost_per_audio_token: numCost(raw.input_cost_per_audio_token),
    output_cost_per_reasoning_token: numCost(raw.output_cost_per_reasoning_token),
    // Non-token pricing (TTS → per character, STT → per second, rerank → per query)
    input_cost_per_character: numCost(raw.input_cost_per_character),
    output_cost_per_character: numCost(raw.output_cost_per_character),
    input_cost_per_second: numCost(raw.input_cost_per_second),
    output_cost_per_second: numCost(raw.output_cost_per_second),
    input_cost_per_query: numCost(raw.input_cost_per_query),
    // Extended token pricing (batch, priority, flex tiers)
    output_cost_per_audio_token: numCost(raw.output_cost_per_audio_token),
    input_cost_per_token_batches: numCost(raw.input_cost_per_token_batches),
    output_cost_per_token_batches: numCost(raw.output_cost_per_token_batches),
    input_cost_per_token_priority: numCost(raw.input_cost_per_token_priority),
    output_cost_per_token_priority: numCost(raw.output_cost_per_token_priority),
    input_cost_per_token_flex: numCost(raw.input_cost_per_token_flex),
    output_cost_per_token_flex: numCost(raw.output_cost_per_token_flex),
    // Image pricing
    input_cost_per_image: numCost(raw.input_cost_per_image),
    output_cost_per_image: numCost(raw.output_cost_per_image),
    // Context-tier pricing (long-context surcharges)
    input_cost_per_token_above_200k_tokens: numCost(raw.input_cost_per_token_above_200k_tokens),
    output_cost_per_token_above_200k_tokens: numCost(raw.output_cost_per_token_above_200k_tokens),
    cache_read_input_token_cost_above_200k_tokens: numCost(raw.cache_read_input_token_cost_above_200k_tokens),
    cache_creation_input_token_cost_above_200k_tokens: numCost(raw.cache_creation_input_token_cost_above_200k_tokens),
    input_cost_per_token_above_272k_tokens: numCost(raw.input_cost_per_token_above_272k_tokens),
    output_cost_per_token_above_272k_tokens: numCost(raw.output_cost_per_token_above_272k_tokens),
    cache_read_input_token_cost_above_272k_tokens: numCost(raw.cache_read_input_token_cost_above_272k_tokens),
    // Rate limits
    rpm: (Number.isInteger(raw.rpm) && raw.rpm > 0) ? raw.rpm : undefined,
    tpm: (Number.isInteger(raw.tpm) && raw.tpm > 0) ? raw.tpm : undefined,
    // Model metadata
    output_vector_size: numPositive(raw.output_vector_size),
    deprecation_date: (typeof raw.deprecation_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.deprecation_date))
      ? raw.deprecation_date : undefined,
    max_input_tokens: numPositive(raw.max_input_tokens ?? raw.max_tokens),
    max_output_tokens: numPositive(raw.max_output_tokens),
    capabilities,
    source: 'litellm',
  };
  // Drop undefined keys for a clean artifact.
  return Object.fromEntries(Object.entries(model).filter(([, v]) => v !== undefined));
}

async function main() {
  const upstream = stripDocKeys(await readJson('upstream/litellm/prices.json'));
  const providers = await readJson('patches/providers.json');
  const pricingPatch = stripDocKeys(await readJson('patches/pricing.json'));
  const capPatch = stripDocKeys(await readJson('patches/capabilities.json'));

  const models = {};
  for (const [modelId, raw] of Object.entries(upstream)) {
    if (modelId === 'sample_spec') continue; // LiteLLM documentation placeholder, not a real model
    if (!raw || typeof raw !== 'object') continue;
    models[modelId] = normalizeModel(modelId, raw, providers);
  }

  // Apply pricing corrections (shallow merge, flips source).
  for (const [modelId, patch] of Object.entries(pricingPatch)) {
    const base = models[modelId] || { provider: 'unknown', platform: 'unknown', mode: 'unknown', capabilities: {} };
    models[modelId] = { ...base, ...stripDocKeys(patch), source: 'patch' };
  }
  // Apply capability corrections (merge into capabilities, flips source).
  for (const [modelId, patch] of Object.entries(capPatch)) {
    const base = models[modelId];
    if (!base) continue;
    models[modelId] = {
      ...base,
      capabilities: { ...base.capabilities, ...stripDocKeys(patch) },
      source: 'patch',
    };
  }

  // Clients.
  const clients = {};
  for (const name of ['claude-code', 'codex', 'antigravity']) {
    const c = await readJson(`clients/${name}.json`);
    clients[c.client] = {
      description: c.description,
      homepage: c.homepage,
      updated: c.updated,
      models: [...new Set(c.models)].sort(),
    };
  }

  // Provenance from SOURCE_SHA.
  const provText = await readFile(p('upstream/litellm/SOURCE_SHA'), 'utf8');
  const prov = Object.fromEntries(
    provText.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
  );

  // Sort model keys for stable output.
  const sortedModels = Object.fromEntries(Object.keys(models).sort().map((k) => [k, models[k]]));
  const payload = { models: sortedModels, clients };
  const version = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);

  const catalog = {
    version,
    generated_at: prov.fetched_at || 'unknown',
    upstream: { source: 'litellm', sha: prov.commit || 'unknown', fetched_at: prov.fetched_at || 'unknown' },
    ...payload,
  };

  await mkdir(p('dist'), { recursive: true });
  await writeFile(p('dist/catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  await writeFile(p('dist/catalog.sha'), version + '\n');

  const patched = Object.values(models).filter((m) => m.source === 'patch').length;
  console.log(
    `build: ${Object.keys(models).length} models (${patched} patched), ` +
      `${Object.keys(clients).length} clients -> dist/catalog.json @ ${version}`,
  );
}

main().catch((err) => {
  console.error(`build failed: ${err.stack || err.message}`);
  process.exit(1);
});
