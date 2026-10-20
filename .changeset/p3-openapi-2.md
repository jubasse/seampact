---
"@seampact/openapi": minor
---

Add `mergeDocuments`, which writes the OpenAPI documents of several apis as one merged document, keeping identical elements once, prefixing an api's operation ids and component keys on request, and refusing every clash with its fix.
