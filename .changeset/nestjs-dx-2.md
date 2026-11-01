---
"@seampact/server-runtime": minor
"@seampact/codegen-nestjs": minor
---

NestJS apps can set `responses` and `bodyValidation` in `forRoot`, read `@op.path()`, `.query()`, `.headers()` and `.body()` params, get seampact's warnings through NestJS's Logger, keep NestJS's default JSON parser on their own routes (or pass its options to `configureApp`), and call `createContractDocument` without the OpenAPI version and tag options.
