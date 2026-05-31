#!/usr/bin/env node
// Pull LiteLLM's model_prices_and_context_window.json into upstream/litellm/.
// This is the ONLY writer of upstream/ — never hand-edit those files.
//
// Flow: check upstream commit SHA first; skip the download entirely when the
// pinned commit already matches. When there is drift, download from the
// specific commit SHA URL (not /main/) so the content is guaranteed to
// correspond to the recorded commit.
//
// Records provenance (upstream commit sha + fetch time + content hash) in
// SOURCE_SHA so consumers and reviewers can see exactly which upstream snapshot
// a given dist/ artifact was built from.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM_REPO = 'BerriAI/litellm';
const UPSTREAM_FILE = 'model_prices_and_context_window.json';
const COMMITS_API =
  `https://api.github.com/repos/${UPSTREAM_REPO}/commits?path=${UPSTREAM_FILE}&per_page=1`;

function rawUrl(sha) {
  return `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${sha}/${UPSTREAM_FILE}`;
}

function githubHeaders() {
  return {
    'user-agent': 'llm-model-specs-sync',
    accept: 'application/vnd.github+json',
    ...(process.env.GITHUB_TOKEN
      ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {}),
  };
}

async function get(url, headers = {}) {
  const res = await fetch(url, { headers: { ...githubHeaders(), ...headers } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res;
}

async function latestCommitSha() {
  try {
    const res = await get(COMMITS_API);
    const commits = await res.json();
    return Array.isArray(commits) && commits[0]?.sha ? commits[0].sha : null;
  } catch (err) {
    console.warn(`warn: could not resolve upstream commit sha: ${err.message}`);
    return null;
  }
}

async function pinnedCommitSha() {
  try {
    const text = await readFile(resolve(ROOT, 'upstream/litellm/SOURCE_SHA'), 'utf8');
    const line = text.split('\n').find((l) => l.startsWith('commit='));
    const sha = line?.slice('commit='.length).trim();
    return sha && sha !== 'unknown' ? sha : null;
  } catch {
    return null;
  }
}

async function main() {
  const [latest, pinned] = await Promise.all([latestCommitSha(), pinnedCommitSha()]);

  if (latest && pinned && latest === pinned) {
    console.log(`sync: already up to date (commit ${latest.slice(0, 12)})`);
    return;
  }

  const sha = latest ?? 'main';
  const url = rawUrl(sha);
  console.log(`sync: fetching ${url}`);
  const res = await get(url);
  const text = await res.text();

  // Parse only to validate and count entries — store the raw text as-is to avoid
  // any round-trip risk (float precision, key reordering) and keep the file an
  // exact byte-for-byte mirror of what LiteLLM ships.
  const parsed = JSON.parse(text);
  const stable = text.endsWith('\n') ? text : text + '\n';
  const contentSha = createHash('sha256').update(stable).digest('hex');
  const fetchedAt = new Date().toISOString();

  await mkdir(resolve(ROOT, 'upstream/litellm'), { recursive: true });
  await writeFile(resolve(ROOT, 'upstream/litellm/prices.json'), stable);
  await writeFile(
    resolve(ROOT, 'upstream/litellm/SOURCE_SHA'),
    [
      '# Provenance of upstream/litellm/prices.json — written by scripts/sync.mjs.',
      '# Do not edit by hand. Format: key=value, one per line.',
      `source=${url}`,
      `commit=${latest ?? 'unknown'}`,
      `fetched_at=${fetchedAt}`,
      `content_sha256=${contentSha}`,
      '',
    ].join('\n'),
  );

  const count = Object.keys(parsed).filter((k) => !k.startsWith('_')).length;
  const commitStr = latest ? latest.slice(0, 12) : 'unknown';
  console.log(`sync: wrote ${count} upstream entries (commit ${commitStr}, sha ${contentSha.slice(0, 12)})`);
}

main().catch((err) => {
  console.error(`sync failed: ${err.stack || err.message}`);
  process.exit(1);
});
