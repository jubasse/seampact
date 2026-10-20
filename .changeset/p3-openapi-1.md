---
"@seampact/openapi": minor
---

Add the OpenAPI 3.1 emitter, which writes each api's documents from the IR with the `x-seampact-*` extensions and their published JSON Schemas, under the `extensions`, `reasons`, `inputSchemas` and `servers` options, and reports the first line where a committed document drifts.
