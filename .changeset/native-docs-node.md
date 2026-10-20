---
"@seampact/codegen-nestjs": minor
"@seampact/codegen-fastify": minor
"@seampact/codegen-core": minor
"@seampact/cli": minor
"@seampact/spec": minor
---

With `nativeDocs` on, the NestJS and Fastify targets generate the metadata that makes `@nestjs/swagger` and `@fastify/swagger` describe every contract route as the seampact OpenAPI document does, and `generate` reads `frameworkDocs` (`off` is refused with the fix each target states).
