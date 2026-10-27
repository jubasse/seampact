---
"@seampact/server-runtime": minor
"@seampact/codegen-core": minor
"@seampact/codegen-nestjs": minor
"@seampact/codegen-fastify": minor
"@seampact/codegen-adonis": minor
"@seampact/codegen-express": patch
"@seampact/codegen-hono": patch
---

NestJS, Fastify and AdonisJS servers now import their request checks from `@seampact/server-runtime` instead of copying them into each api, and each NestJS api keeps its own `ContractException` and a module class named after the api.
