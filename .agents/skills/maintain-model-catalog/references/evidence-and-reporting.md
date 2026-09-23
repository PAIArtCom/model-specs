# Evidence and Reporting

Use this reference for final review, commits, PR preparation, and handoff.

## Evidence standard

For each consequential decision, retain enough evidence to answer:

- What source was checked, and on what date?
- What exact model ID, client audience, price unit, or capability did it prove?
- Did LiteLLM already contain the fact, require a patch, or make a patch
  redundant?
- Which generated fields or client entries changed?
- What verification ran, and what warnings remain?

Prefer primary vendor documentation and official client repositories. Cite the
specific page or file in patch notes and review summaries. If a dynamic page,
account entitlement, or staged rollout prevents a universal conclusion, state
the uncertainty and narrow the resulting change.

## Final consistency gate

- `npm run build && npm run validate` succeeds.
- `audit-catalog-integrity.mjs` has no errors; each warning is explained.
- Active patches have URL/date provenance.
- Changed client files have current verification dates.
- `dist/catalog.json` and `dist/catalog.sha` reflect the build.
- Removed decisions are removed from normal docs and examples, while genuine
  historical artifacts remain historical.
- `git diff --check` succeeds and the full diff contains no unrelated edits.

## Report shape

Lead with the outcome, then state:

1. pinned LiteLLM commit and delta counts;
2. important vendor/model additions or removals;
3. patch additions, corrections, and retirements;
4. client-list decisions and exclusions;
5. build/schema coverage changes;
6. generated catalog model count and version;
7. commands run, warnings, evidence gaps, and residual risks;
8. commit/push/PR status only if requested.

Do not claim “fully current” when a client source was inaccessible or a rollout
was account-specific. Say exactly which surfaces were verified.
