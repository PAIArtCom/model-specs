# Upstream and Patch Decisions

Use this reference for LiteLLM syncs, vendor releases, specification changes,
pricing changes, and patch review. The root `AGENTS.md` remains authoritative if
anything here conflicts with it.

## Establish the delta

Run `npm run sync`, then use `audit-upstream-delta.mjs`. Review more than the
headline counts:

- added and removed model IDs, grouped by provider and mode;
- changes to models already covered by a patch;
- newly introduced fields, modes, and field-type changes;
- removed upstream IDs still referenced by a client;
- patches whose values now appear equal to normalized upstream data.

Treat redundancy findings as candidates, not automatic deletions. A patch may
still carry a platform correction or other semantic distinction that a shallow
value comparison cannot prove redundant.

## Decision order

1. If current upstream data is correct, use it without a patch.
2. If upstream lacks a model but a vendor primary source publishes objective
   specifications, add the required pricing record before capability data.
3. If upstream is wrong and primary evidence is available, patch only the wrong
   fields and explain the correction in `_note`.
4. If upstream now contains the correction, remove the patch and rebuild.
5. If the fact cannot be verified, leave the catalog unchanged and report the
   evidence gap.

Patch-only model records need `provider`, `platform`, and `mode`. Every active
patch entry needs a source URL and the applicable current date in `YYYY-MM-DD`
form. Preserve distinct billing dimensions instead of forcing them into a
generic token field: token, cached token, image, image token, video token,
second/resolution, request, query, page, storage, session, or multiplier may have
different semantics.

For promotional pricing, store the amount actually billed now and place the
expiry plus known post-expiry action in a `_`-prefixed maintenance note and the
repository maintenance calendar. Re-check rather than automatically applying a
previously announced future price.

## Source discipline

Use current official vendor model and pricing documentation first. Use release
notes or official repositories when they are the primary source for a change.
Secondary aggregators may support an investigation when official material is
unavailable, but disclose that limitation and do not present an estimate as an
objective vendor fact.
