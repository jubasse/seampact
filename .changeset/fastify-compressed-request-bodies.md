---
"@seampact/server-runtime": patch
---

Fastify servers that register `@fastify/compress` now accept gzip request bodies and answer an unknown content coding with 415, a body over the limit once inflated with 413 and a corrupt gzip body with 400, where they refused, failed or hung before.
