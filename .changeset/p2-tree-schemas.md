---
"@seampact/compiler": patch
---

The tree pass compiles every declared schema, named format and declaration schema into the IR's `schemas` and `scalars`, with portable patterns normalised, and reports each refused schema at its file and line.

The tree pass seeds the compiler's own error params, issue and empty body schemas, and refuses a schema that takes one of their reserved names.

The tree pass refuses integer bounds with no integer between them.

The tree pass merges `pick` and `omit` schemas, compiles the enums catalogue, names inline route schemas after their operation, adds the batch ids input and the concurrency version property, and gives every query and form field its query wire.
