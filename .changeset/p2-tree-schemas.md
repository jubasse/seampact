---
"@seampact/compiler": patch
---

The tree pass compiles every declared schema, named format and declaration schema into the IR's `schemas` and `scalars`, with portable patterns normalised, and reports each refused schema at its file and line.

The tree pass seeds the compiler's own error params, issue and empty body schemas, and refuses a schema that takes one of their reserved names.

The tree pass refuses integer bounds with no integer between them.

The tree pass merges `pick` and `omit` schemas into plain objects.

The tree pass compiles the enums catalogue, naming a value without letters or digits by its position.

The tree pass names each inline route schema after its operation and position.

The tree pass derives the ids input of a `batch` op and the version property of a versioned write.

The tree pass gives every query and form field its query wire.
