---
"@seampact/codegen-core": patch
"@seampact/codegen-nestjs": patch
"@seampact/codegen-express": patch
"@seampact/codegen-fastify": patch
"@seampact/codegen-hono": patch
"@seampact/codegen-adonis": patch
---

The Node servers' frameworkRoutes check now stays fast with many `**` in a pattern, and a framework 401, 403 or 429 whose code requires params answers that code when a throttler's `Retry-After` fills them, else a logged 500 naming the fix.
