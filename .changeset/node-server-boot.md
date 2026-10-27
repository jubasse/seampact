---
"@seampact/codegen-core": patch
"@seampact/codegen-nestjs": patch
"@seampact/codegen-express": patch
"@seampact/codegen-fastify": patch
"@seampact/codegen-hono": patch
"@seampact/codegen-adonis": patch
---

The Node servers' frameworkRoutes check now stays fast with many `**` in a pattern, a framework 429 whose rate-limited code needs its delay answers it from the throttler's `Retry-After` (seconds or an HTTP-date, read as UTC), and any other refusal whose code requires params answers a logged 500 naming the fix.
