---
"@seampact/compiler": patch
"@seampact/codegen-core": patch
"@seampact/codegen-ts": patch
"@seampact/openapi": patch
---

A list declared `paging: none` is now generated as a bare array on every Node server, in the TypeScript types and in the OpenAPI document, and an empty surface prefix or an id parameter named `id` now warns with its fix.
