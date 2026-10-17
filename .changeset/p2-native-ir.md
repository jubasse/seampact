---
"@seampact/spec": patch
---

The Kotlin and PHP IR readers share a corpus of reader-check cases with the TypeScript reader's verdicts (`vectors/ir`), and both pass the naming vectors.

The Kotlin IR reader now calls a document text with a bare token JSON refuses, such as `3d` or `NaN`, malformed, as the TypeScript and PHP readers do.
