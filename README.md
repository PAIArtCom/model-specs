# model-specs

A community catalog of **LLM model specifications** — pricing, context windows,
capabilities, and client/CLI compatibility — kept fresh by automatically syncing
[LiteLLM](https://github.com/BerriAI/litellm)'s model database and layering
**objective corrections** plus data LiteLLM doesn't track (which models each AI CLI
actually accepts).

If you build AI applications and keep re-implementing the same "what does this model
cost / what's its context window / does this CLI accept this model id" lookups, this
repo is meant to be the single source you vendor or fetch.

## What's in here

| Directory | What it holds | Edit by hand? |
|---|---|---|
| `upstream/litellm/` | A read-only mirror of LiteLLM's `model_prices_and_context_window.json`, refreshed by CI. | **No** — auto-synced |
| `patches/` | Objective corrections to the upstream data (wrong pricing, provider/platform mapping, capability flags). | Yes — via PR |
| `clients/` | Which model ids each AI CLI / client accepts (Claude Code, Codex, Antigravity). LiteLLM does not track this. | Yes — via PR |
| `dist/` | The merged, validated artifact consumers read: `catalog.json` + `catalog.sha`. | **No** — generated |
| `schema/` | JSON Schema for `dist/catalog.json`. | Yes |
| `scripts/` | `sync` (pull upstream), `build` (merge → dist), `validate` (schema + invariants). | Yes |

**Design rule:** `upstream/` is never hand-edited. Every correction lives in
`patches/` so `git diff` always shows exactly what we changed vs. what LiteLLM
shipped, and the merge stays reproducible.

## What's intentionally NOT here

- **Pricing markup / margin.** This repo holds *objective* base costs only. Your
  selling price is your business policy — keep it in your own app.
- **Which models a given product chooses to sell.** That's product config, not a
  community fact. Keep served-model lists in your own project.

## Consuming the catalog

Read `dist/catalog.json`. Two patterns:

1. **Vendor + embed** — add this repo as a git submodule and embed
   `dist/catalog.json` at build time. Reproducible, offline-safe, but updates need a
   rebuild.
2. **Embed floor + scheduled refresh** *(recommended for services)* — embed
   `dist/catalog.json` as the offline fallback, and have a scheduled job fetch the
   latest artifact (raw URL or a GitHub Release asset), verify `catalog.sha`, and
   upsert into your store. New models / price changes land without redeploying.

### Shape of `dist/catalog.json`

```jsonc
{
  "version": "<sha256[:12] of the models+clients payload>",
  "generated_at": "<ISO-8601 — reflects upstream fetch time, not build time>",
  "upstream": { "source": "litellm", "sha": "<commit>", "fetched_at": "<ISO-8601>" },
  "models": {
    "gpt-4o": {
      "provider": "openai",
      "platform": "openai",
      "mode": "chat",
      "input_cost_per_token": 2.5e-6,
      "output_cost_per_token": 1.0e-5,
      "cache_read_input_token_cost": 1.25e-6,
      "cache_creation_input_token_cost": 2.5e-6,
      "cache_creation_input_token_cost_above_1hr": 5e-6,  // Anthropic extended cache
      "input_cost_per_audio_token": 1e-6,                 // multimodal models
      "output_cost_per_reasoning_token": 2.5e-6,          // reasoning models
      "max_input_tokens": 128000,
      "max_output_tokens": 16384,
      "capabilities": { "function_calling": true, "vision": true, "prompt_caching": true },
      "source": "litellm"
    }
  },
  "clients": {
    "claude-code": { "description": "...", "models": ["claude-sonnet-4-6"], "updated": "<date>" }
  }
}
```

All cost fields are **USD per token** (not per million). `source` on each model is
`litellm` (verbatim from upstream) or `patch` (corrected here). `platform` is the
normalized vendor (e.g. all `vertex_ai-anthropic*` → `anthropic`), distinct from
LiteLLM's finer-grained `provider`.

## Contributing

```bash
npm install   # first time only — installs ajv for validate
```

1. To fix a price/capability/provider: edit the right file under `patches/`.
2. To update a CLI's accepted models: edit `clients/<client>.json`.
3. Run `npm run build && npm run validate` and open a PR. CI rebuilds `dist/` and
   fails on schema or invariant violations.

## License

MIT. The data under `upstream/litellm/` is mirrored from
[BerriAI/litellm](https://github.com/BerriAI/litellm) (also MIT) — attribution
retained in `upstream/litellm/SOURCE_SHA`.
