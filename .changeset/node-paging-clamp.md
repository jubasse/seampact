---
"@seampact/server-runtime": patch
"@seampact/codegen-core": patch
"@seampact/codegen-express": patch
"@seampact/codegen-hono": patch
"@seampact/codegen-fastify": patch
"@seampact/codegen-nestjs": patch
"@seampact/codegen-adonis": patch
---

The Node servers now serve a limit above `maxLimit` as `maxLimit` under `overLimit: clamp`, to the handler and in the page, instead of passing it through as sent.
