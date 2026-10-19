---
"@seampact/compiler": patch
"@seampact/codegen-ts": patch
---

An operation that refuses undeclared query keys now declares the schema-invalid 400 even without input, so `GET /v1/health?x=1` answers 400 instead of 500.
A sort parameter now admits only the declared sort keys in its style's form (`createdAt`, `-createdAt`), and the generated TypeScript input types it as that union.
