# Client Compatibility

Use this reference when changing `clients/*.json`. Consult the authoritative
source matrix and client-specific commands in the root `AGENTS.md`; do not keep
a second source list here.

## Separate availability states

Do not derive client support merely because an API model exists. Record the
client set only after distinguishing:

- accepted when explicitly named;
- visible in the normal picker;
- available to ordinary eligible accounts;
- staged or region/subscription gated;
- invitation-only, allowlisted, separately approved, internal, or experimental.

When a client file represents ordinary user-selectable models, exclude models
that require separate approval or invitation unless the file explicitly defines
another audience. A hidden-but-accepted ID may be included only when the
authoritative client source establishes that behavior and the description says
so.

## Review procedure

1. Read the current client file and its audience definition.
2. Check current official client documentation or structured source. For a
   repository-hosted model list, review recent path history as well as the latest
   file so visibility transitions are not missed.
3. Compare exact IDs and aliases. Do not substitute API aliases, provider-hosted
   IDs, or a related model family without evidence.
4. Update `description` when eligibility, minimum client version, picker status,
   or exclusions changed.
5. Set `updated` to the date actually verified, even if the model array did not
   change.
6. Rebuild and classify every missing-catalog warning. A client can legitimately
   accept an ID that LiteLLM does not yet price, but that gap must be explicit.

Adding a new client file also requires confirming that `scripts/build.mjs`
discovers or names it; the integrity audit reports files that would otherwise be
silently omitted.
