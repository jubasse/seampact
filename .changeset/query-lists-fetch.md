---
"@seampact/codegen-core": patch
"@seampact/codegen-fetch": patch
---

The fetch client now sends a list query parameter in the default `repeat` form as repeated keys (`state=open&state=done`) instead of refusing it, so `@seampact/pack-spring`'s pair sort is generated too. An empty list is left out of the query string.
