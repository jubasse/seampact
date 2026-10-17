---
"@seampact/compiler": patch
---

The tree pass compiles every declared schema, named format and declaration schema into the IR's `schemas` and `scalars`, with portable patterns normalised, and reports each refused schema at its file and line.

The tree pass seeds the compiler's own error params, issue and empty body schemas, and refuses a schema that takes one of their reserved names.

The tree pass refuses integer bounds with no integer between them.
