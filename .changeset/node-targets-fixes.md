---
"@seampact/codegen-core": patch
"@seampact/codegen-ts": patch
"@seampact/codegen-fetch": patch
"@seampact/codegen-express": patch
"@seampact/codegen-fastify": patch
---

Node servers and the fetch client answer a batch read as an object keyed by item id, keep the boundary's ETag through `hono/compress`, accept a Fastify prefix equal to the base path with boundary replies compressed under `@fastify/compress`, and report Express replies outside a request to the router that serves the app.
