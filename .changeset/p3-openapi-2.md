---
"@seampact/openapi": minor
---

Add `mergeDocuments`, which writes the OpenAPI documents of several apis as one merged document, listing each api's version, docs and root extensions, keeping identical elements once, prefixing an api's operation ids and component keys on request, and refusing every clash with its fix.
