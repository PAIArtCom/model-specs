#!/usr/bin/env node
// Pull LiteLLM's model_prices_and_context_window.json into upstream/litellm/.
// This is the ONLY writer of upstream/ — never hand-edit those files.
//
// Records provenance (upstream commit sha + fetch time + content hash) in
// SOURCE_SHA so consumers and reviewers can see exactly which upstream snapshot
// a given dist/ artifact was built from.

import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const COMMITS_API =
  'https://api.github.com/repos/BerriAI/litellm/commits?path=model_prices_and_context_window.json&per_page=1';

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'user-agent': 'llm-model-specs-sync', ...headers } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res;
}

async function latestCommitSha() {
  try {
    const headers = process.env.GITHUB_TOKEN
      ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {};
    const res = await fetchJson(COMMITS_API, headers);
    const commits = await res.json();
    return Array.isArray(commits) && commits[0]?.sha ? commits[0].sha : 'unknown';
  } catch (err) {
    console.warn(`warn: could not resolve upstream commit sha: ${err.message}`);
    return 'unknown';
  }
}

async function main() {
  console.log(`sync: fetching ${RAW_URL}`);
  const res = await fetchJson(RAW_URL);
  const text = await res.text();

  // Parse to fail fast on malformed upstream, then re-serialize stably so diffs
  // are meaningful (sorted keys) rather than reflecting upstream formatting churn.
  const parsed = JSON.parse(text);
  const stable = JSON.stringify(parsed, Object.keys(parsed).sort(), 2) + '\n';
  const contentSha = createHash('sha256').update(stable).digest('hex');
  const commit = await latestCommitSha();
  const fetchedAt = new Date().toISOString();

  await mkdir(resolve(ROOT, 'upstream/litellm'), { recursive: true });
  await writeFile(resolve(ROOT, 'upstream/litellm/prices.json'), stable);
  await writeFile(
    resolve(ROOT, 'upstream/litellm/SOURCE_SHA'),
    [
      '# Provenance of upstream/litellm/prices.json — written by scripts/sync.mjs.',
      '# Do not edit by hand. Format: key=value, one per line.',
      `source=${RAW_URL}`,
      `commit=${commit}`,
      `fetched_at=${fetchedAt}`,
      `content_sha256=${contentSha}`,
      '',
    ].join('\n'),
  );

  const count = Object.keys(parsed).filter((k) => !k.startsWith('_')).length;
  console.log(`sync: wrote ${count} upstream entries (commit ${commit.slice(0, 12)}, sha ${contentSha.slice(0, 12)})`);
}

main().catch((err) => {
  console.error(`sync failed: ${err.stack || err.message}`);
  process.exit(1);
});
