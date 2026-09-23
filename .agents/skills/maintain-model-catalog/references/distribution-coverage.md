# Distribution Coverage

Use this reference when upstream introduces new fields or modes, when a value is
present in LiteLLM but absent from `dist`, or when build/schema dispatch or
distribution integrity is under review.

## End-to-end contract

A meaningful upstream value is not preserved merely because `npm run build`
succeeds. Trace each new concept across the complete path:

```text
upstream field
  -> scripts/build.mjs normalization
  -> schema/catalog.schema.json
  -> dist/catalog.json spot check
  -> README.md public contract when consumer-visible
  -> scripts/validate.mjs semantics when a new unit changes bounds
```

Check these categories separately:

- new `mode` values;
- scalar prices and tiered/context prices;
- object-valued cost maps;
- cache, batch, priority, flex, and regional multipliers;
- modality-specific and resolution-specific prices;
- capability booleans and non-boolean model metadata;
- field-type or unit changes on an existing key.

Run the delta audit to identify fields introduced since the selected git base.
Run the integrity audit to check build/schema drift and unsupported modes. A new
field is a review candidate, not an automatic public-contract addition: preserve
it when it is objective, has understood semantics, and fits this catalog's
pricing/specification purpose. Document intentional omission when it is likely
to recur or surprise future maintainers.

When adding a cost field, ensure validation applies the correct unit. Token-price
heuristics must not reject legitimate per-second, per-image, per-page, per-query,
or per-session prices. When adding a capability, preserve the upstream meaning;
do not turn a false/unknown state into true through family resemblance.

Spot-check at least one affected model per distinct field shape or mode after
building. Compare upstream and `dist` directly, including nested maps and zero
values.
