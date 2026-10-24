---
"@seampact/codegen-core": patch
"@seampact/codegen-express": patch
"@seampact/codegen-fastify": patch
"@seampact/codegen-nestjs": patch
"@seampact/codegen-adonis": patch
"@seampact/codegen-hono": patch
---

Behind a reverse proxy, page links are written as query-only references (`?page=2`) that keep a stripped path prefix, and the hooks' client address follows the app's own trust-proxy setting on Express, Fastify, NestJS and AdonisJS.
