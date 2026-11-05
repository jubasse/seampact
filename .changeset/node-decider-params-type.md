---
"@seampact/codegen-core": patch
"@seampact/codegen-nestjs": patch
"@seampact/codegen-fastify": patch
"@seampact/codegen-express": patch
"@seampact/codegen-adonis": patch
"@seampact/codegen-hono": patch
---

The Node server decide request now types the params of a right or rule with its declared params type instead of `unknown`, and a right or rule without params as `never`.
