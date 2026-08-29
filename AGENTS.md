# Data update guide

How to keep this catalog current. Read this before changing any data file.
For what the repo is and how consumers read `dist/catalog.json`, see `README.md`.

## Hard rules

1. **Never hand-edit `upstream/litellm/`.** `scripts/sync.mjs` is its only writer.
   Every correction to upstream data goes in `patches/` instead, so `git diff`
   always shows exactly what we changed versus what LiteLLM shipped.
2. **Never hand-edit `dist/`.** `scripts/build.mjs` is its only writer — but always
   *commit* the rebuilt `dist/`. `.github/workflows/build.yml` rebuilds on every
   push and fails the job when the committed `dist/` is stale.
3. **Hand-edited by design:** `patches/`, `clients/`, `schema/`.
4. **Objective data only.** No pricing markup, no "which models our product sells".
   Base costs published by the vendor, nothing else.
5. **Every patch entry carries a `_note`** with a source URL and the date you
   checked it. Keys starting with `_` are stripped at build time, so they cost
   nothing in `dist/` and are the right place for reasoning and provenance.

## Commands

```bash
npm install       # first time only (ajv, ajv-formats)
npm run sync      # refresh upstream/ — no-op when the pinned commit already matches
npm run build     # patches + clients + upstream -> dist/
npm run validate  # JSON Schema + semantic invariants; exits non-zero on failure
npm run all       # sync && build && validate
```

`npm run build && npm run validate` is mandatory before every commit, including
commits that only touch `clients/` or a `_note`.

## Recipe A — routine upstream sync

CI does this weekly (`.github/workflows/sync.yml`, Mondays 06:17 UTC) and opens a
PR rather than pushing to `main`, because pricing changes are revenue-affecting
and deserve a human glance at the diff. Doing it by hand:

```bash
npm run all
```

Then read the diff before committing. `upstream/litellm/prices.json` is ~3,000
entries, so summarize instead of scrolling:

```bash
node -e "
const {execSync}=require('child_process');
const old=JSON.parse(execSync('git show HEAD:upstream/litellm/prices.json',{maxBuffer:1e9}));
const cur=require('./upstream/litellm/prices.json');
const added=Object.keys(cur).filter(k=>!(k in old));
const removed=Object.keys(old).filter(k=>!(k in cur));
const changed=Object.keys(cur).filter(k=>k in old&&JSON.stringify(old[k])!==JSON.stringify(cur[k]));
console.log({added, removed, changed: changed.length});
"
```

Look for: models removed upstream that a `clients/` list still references, and
price changes on models we patch (a patch may have become redundant or wrong).

## Recipe B — a vendor released a new model

1. **Sync first.** New models usually reach LiteLLM within days, and an upstream
   entry is always preferable to a patch.
2. **Still missing, and the vendor publishes specs?** Add it to
   `patches/pricing.json`. With no upstream base to merge over, the entry must
   carry `provider`, `platform`, and `mode` itself, plus costs and token limits.
3. **Capabilities** go in `patches/capabilities.json`. Note the ordering
   constraint in `build.mjs`: capability patches are skipped for models that
   don't exist yet, and pricing patches are applied first — so a patch-only model
   needs its `pricing.json` entry for the `capabilities.json` entry to take effect.
4. Copy the capability set from the closest sibling model rather than inventing
   flags, and record which sibling in the `_note`.

## Recipe C — a CLI changed its model list

One file per client under `clients/`. Bump `updated` to the date you checked,
even when the list itself didn't change — the field means "verified on", not
"last modified". Keep `models` to ids that exist in the catalog where possible;
`validate` warns (not fails) on ids with no catalog entry.

| Client | Authoritative source | How to check |
|---|---|---|
| `claude-code` | [code.claude.com/docs/en/model-config](https://code.claude.com/docs/en/model-config) + [platform.claude.com models overview](https://platform.claude.com/docs/en/about-claude/models/overview) | model-config gives aliases and minimum CLI versions; the overview gives the current + legacy id lists. Record minimum CLI versions in `description`. Exclude Bedrock/Vertex/Foundry ids and non-GA models. |
| `codex` | [`codex-rs/models-manager/models.json`](https://github.com/openai/codex/blob/main/codex-rs/models-manager/models.json) on `main` | Read the `visibility` field per entry: `list` = offered in the picker, `hide` = still accepted by name but not shown. Omit internal-only entries such as `codex-auto-review`. A model set that looks unchanged can still have moved between `list` and `hide` — diff the file across commits (see below). |
| `antigravity` | [antigravity.google/docs/models](https://antigravity.google/docs/models) | Model availability varies by subscription tier; list the union. |
| `google-flow` | [labs.google/fx/tools/flow](https://labs.google/fx/tools/flow) + Gemini API docs | Staged rollout and region-gated; note that in `description`. |

For `codex`, the file changes more often than the visible model set, so check the
path's history and compare specific commits rather than trusting `main` alone:

```bash
curl -s "https://api.github.com/repos/openai/codex/commits?path=codex-rs/models-manager/models.json&per_page=10" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s).forEach(c=>console.log(c.commit.committer.date, c.sha.slice(0,8), c.commit.message.split('\n')[0])))"
```

Then fetch `https://raw.githubusercontent.com/openai/codex/<sha>/codex-rs/models-manager/models.json`
for the commits around your last `updated` date and diff the slug/visibility pairs.

## Recipe D — prices changed

All cost fields are **USD per token**, matching LiteLLM. `$3 / MTok` is `3e-6`.
`validate` warns above `0.001` per token and fails above `1`.

Take cache rates from the vendor's published table rather than deriving them from
a multiplier — the multipliers hold today but are not a contract.

**Time-limited pricing** (introductory rates, promos): record what customers are
actually billed right now, and leave a `_`-prefixed note in `patches/pricing.json`
stating the expiry date and the exact values to apply afterwards. See
`_claude_sonnet_5_intro_pricing_note` for the established format.

## Before committing

- [ ] `npm run build && npm run validate` — expect `validate: OK`, ideally 0 warnings
- [ ] Every `validate` warning is understood. `client X: model "Y" has no catalog
      entry` means a client list references an id with no pricing data: either add
      a `patches/pricing.json` entry or accept it deliberately.
- [ ] `dist/catalog.json` and `dist/catalog.sha` are staged
- [ ] Touched `clients/*.json` files have a bumped `updated` date
- [ ] New patch entries have a `_note` with source URL + date
- [ ] Claims in the commit message match what you actually ran

## Recurring maintenance

Deprecations and expiries are the easiest thing to miss, because nothing fails
when they lapse — the data just goes quietly wrong. Known dates:

| Date | Action |
|---|---|
| 2026-08-05 | `claude-opus-4-1-20250805` retires — drop from `clients/claude-code.json` |
| 2026-08-17 | Imagen models shut down (already excluded from `clients/google-flow.json`) |
| 2026-08-31 | `gpt-5.4` and `gpt-5.4-mini` retire from the ChatGPT OAuth path — drop from `clients/codex.json` |
| 2026-08-31 | Claude Sonnet 5 introductory pricing ends — see the note in `patches/pricing.json` |

When you learn a future date, add a row here in the same commit.

## Commit conventions

Conventional-commit prefixes, matching the existing history: `feat:` for new
models or client entries, `chore:` for routine syncs, `fix:` for corrections,
`docs:` for notes and guides. State what you verified and how; if you left
something out, say so and why.
