---
"@seampact/server-runtime": patch
"@seampact/codegen-core": patch
"@seampact/codegen-express": patch
"@seampact/codegen-fastify": patch
"@seampact/codegen-hono": patch
"@seampact/codegen-nestjs": patch
"@seampact/codegen-adonis": patch
---

Handlers on Express, Fastify, Hono, NestJS and AdonisJS read their caller's typed `principal` and resolved `scopes` on their input, and NestJS methods can also take them with `@<operation>.principal()` and `@<operation>.scopes()`.
