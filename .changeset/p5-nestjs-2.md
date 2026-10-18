---
"@seampact/cli": patch
"@seampact/codegen-core": patch
---

`seampact generate` now prints on stderr each warning a target returns, naming the contract form your handler enforces, and a list filter right (`filteredBy`) no longer warns, since applying it is the application's by design.
