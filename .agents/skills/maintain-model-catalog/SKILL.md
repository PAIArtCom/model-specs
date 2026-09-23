---
name: maintain-model-catalog
description: Maintain this repository's LiteLLM-derived model catalog, objective pricing and capability patches, client model compatibility, schema/build field coverage, and generated distribution. Use for upstream syncs, model releases, pricing changes, client-list audits, patch retirement, or catalog distribution-integrity reviews. Do not use for general model recommendations or API application development.
---

# Maintain Model Catalog

Start by reading the repository-root `AGENTS.md` completely. It is the source of
truth for data ownership, authoritative client sources, dated maintenance items,
validation requirements, and commit conventions. Read `README.md` when a change
may affect the public catalog contract. Do not copy dynamic model lists, source
URLs, retirement dates, or version requirements into this skill.

## Classify the task

Choose only the relevant paths:

- LiteLLM sync, new model, price/spec change, or patch lifecycle: read
  [references/upstream-and-patches.md](references/upstream-and-patches.md).
- Client support or picker availability: read
  [references/client-compatibility.md](references/client-compatibility.md).
- New upstream fields/modes, missing `dist` data, schema/build changes, or a
  request about "dispatch" in this repository: read
  [references/distribution-coverage.md](references/distribution-coverage.md).
- Before reporting, committing, or opening a PR: read
  [references/evidence-and-reporting.md](references/evidence-and-reporting.md).

If "dispatch" is mentioned, first search for an actual repository concept with
that name. If none exists, state that you are treating it as distribution/build
coverage; do not silently reinterpret an established project term.

## Common workflow

1. Inspect the worktree and record the current upstream commit, catalog version,
   client verification dates, and existing validation warnings. Preserve
   unrelated user changes.
2. For data maintenance other than a clearly isolated client-only review, run
   `npm run sync` before deciding whether a patch is needed. Never hand-edit
   `upstream/litellm/` or `dist/`.
3. Run the delta audit after syncing:

   ```bash
   node .agents/skills/maintain-model-catalog/scripts/audit-upstream-delta.mjs
   ```

4. Verify time-sensitive claims against current primary sources. LiteLLM is the
   import source, not sufficient evidence for correcting LiteLLM itself.
5. Apply the smallest objective change. Treat API availability, client
   acceptance, picker visibility, staged rollout, invitation-only access, and
   ordinary-user availability as different facts.
6. Rebuild and validate, then run the integrity audit:

   ```bash
   npm run build && npm run validate
   node .agents/skills/maintain-model-catalog/scripts/audit-catalog-integrity.mjs
   git diff --check
   ```

7. Inspect affected entries in `dist/catalog.json` and perform a repository-wide
   consistency search for removed IDs, expired notes, old dates, and changed
   terminology.

## Stop rather than guess

Do not invent or infer data when a primary source does not establish the price,
unit, specification, retirement date, or client entitlement. Stop and report the
gap when the upstream commit cannot be pinned, a new field's unit is unclear,
overlapping user edits cannot be preserved, validation failures remain
unexplained, or a new warning has not been classified.

Never commit, push, open a PR, publish, or change external state unless the user
has authorized that action. A request to update data authorizes repository edits
and verification, not those external actions.
