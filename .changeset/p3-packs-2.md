---
"@seampact/http-suite": minor
"@seampact/openapi": patch
---

The HTTP suite now has a `pack:<name>` profile per convention pack that reads a pack's items, pages and errors back to the bare shape and adds the pack's own page, media type and error cases, and the OpenAPI emitter writes a text made of constants (`/contexts/Task`) as one constant.
