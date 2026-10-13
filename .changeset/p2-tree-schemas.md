---
"@seampact/compiler": patch
---

The tree pass compiles every declared schema, named format and declaration schema into the IR's `schemas` and `scalars`, with portable patterns normalised, and reports each refused schema at its file and line.
