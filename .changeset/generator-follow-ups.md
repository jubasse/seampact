---
"@seampact/codegen-core": patch
"@seampact/codegen-fetch": patch
---

A comma query list keeps an encoded comma inside its item on the Node servers and in their next page links, and the next page links stay valid for a raw `>` or `"` in the query, and the fetch client reports a non-JSON or `null` success as unexpected, takes an `idempotencyKey` generator for platforms without `crypto.randomUUID` (refusing at creation when neither exists), and works without `AbortSignal.any`, `AbortSignal.timeout` or `URL.canParse`.
