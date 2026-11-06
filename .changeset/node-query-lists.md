---
"@seampact/server-runtime": patch
"@seampact/codegen-core": patch
"@seampact/codegen-express": patch
"@seampact/codegen-fastify": patch
"@seampact/codegen-hono": patch
"@seampact/codegen-nestjs": patch
"@seampact/codegen-adonis": patch
---

Express, Fastify, Hono, NestJS and AdonisJS servers accept query lists in the default `repeat` form (`tag=a&tag=b`), which they refused at generate time before, and decode each list item by its type, so a list of numbers or booleans is no longer refused. Spring Boot servers split a comma-separated query list (`sort=a,b`) into its items, which reached the validator as one item before.
