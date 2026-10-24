---
"@seampact/codegen-zod": minor
---

Generated zod validators now use zod's own `.min()`, `.max()`, `z.uuid()`, `z.iso.datetime()` and `.multipleOf()`; set `rules: seampact-consistent` to keep the contract's exact checks.
