---
"@seampact/codegen-core": patch
"@seampact/codegen-ts": patch
---

A paging style's `total`, `more`, `previousCursor`, `nextSince` and `complete` handler results are now typed, and every Node server writes the page body, meta members, headers and links the style declares, with a format's item, list and table envelopes such as Laravel's `data`.
