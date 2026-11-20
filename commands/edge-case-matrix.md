---
name: edge-case-matrix
description: Generate and inspect a reproducible QA fixture matrix from a synthetic schema or the bundled checkout example.
---

Use the edge-case-studio skill and its bundled local generator. If given no schema, demonstrate the checkout sample with seed checkout-42. Return counts and a concrete pair of payloads straddling the same boundary, with the expected field and rule. For contracts without a boundary pair, contrast the baseline with one emitted negative; never invent a rule or an endpoint result. Offer exports only if useful. Never upload schemas or fixtures, call an API, or write to an application database.
