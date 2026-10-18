---
"@seampact/codegen-fetch": minor
"@seampact/signed-webhooks": minor
"@seampact/idempotency-memory": minor
"@seampact/spec": patch
"@seampact/compiler": patch
"@seampact/codegen-core": patch
"@seampact/cli": patch
"@seampact/hooks": patch
"@seampact/codegen-ts": patch
"@seampact/codegen-zod": patch
---

Add `@seampact/codegen-fetch`, which generates a typed fetch client that returns each operation's success and error responses as typed results, or throws them as a typed `ClientContractError` with `errorStyle: throw`, and fills the idempotency key and deadline headers.

Add `@seampact/signed-webhooks`, which verifies HMAC-signed webhooks with timestamp tolerance and secret rotation inside your authenticate hook.

Add `@seampact/idempotency-memory`, an in-memory idempotency store for one process, for development and tests.

The seampact packages now pack with built JavaScript and type declarations, so they install from tarballs.
