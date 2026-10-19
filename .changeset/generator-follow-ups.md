---
"@seampact/codegen-core": patch
"@seampact/codegen-fetch": patch
---

A comma query list keeps an encoded comma inside its item on the Node servers and in their next page links, and the fetch client reports a non-JSON success as unexpected, takes an `idempotencyKey` generator for platforms without `crypto.randomUUID` (refusing at creation when neither exists), and works without `AbortSignal.any` or `AbortSignal.timeout`.
