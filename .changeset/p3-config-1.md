---
"@seampact/spec": minor
"@seampact/cli": minor
"@seampact/codegen-core": minor
"@seampact/codegen-adonis": patch
"@seampact/codegen-class-validator": patch
"@seampact/codegen-fetch": patch
"@seampact/codegen-ts": patch
"@seampact/codegen-yup": patch
"@seampact/codegen-zod": patch
---

A monorepo root `seampact.config.yaml` now lists its apps and shares its sources and `allowLocal` with them, and `generate` writes each app's OpenAPI documents, by default those of the apis its server targets serve, or the ones its `openapi` key lists, so an app with no targets generates documents only.
