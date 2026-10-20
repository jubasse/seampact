---
"@seampact/codegen-fetch": minor
---

The fetch client reads wrapped success bodies and every page shape a paging style declares (a `{ data, meta }` envelope, members beside the items, headers and `Link` relations) and returns the items with typed page facts such as `total`, `page`, `nextCursor` and `next`.
