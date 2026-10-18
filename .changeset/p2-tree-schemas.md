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

The tree pass parses every schema example against its schema.

The tree pass writes the directions each schema, enum and named format is used in.

The tree pass moves a use's `unknownKeys` onto its input use, and refuses it on an output-only use or a map.

The tree pass keeps a schema's deprecation and the docs and examples of properties, variants and nested schemas.

The tree pass refuses a map as a query field or header rule proof.

The tree pass hoists the params of an error code once, wherever the code is declared.

The tree pass parses every property default against its schema like an example.

The tree pass accepts a default on an optional query field and parses it like an example.

The tree pass copies the schemas, enums, named formats and extension keys a relay route uses from the public api, and refuses one that differs from this api's or another relayed api's declaration of the same name.

The tree pass refuses a map in a body rule proof that a form or multipart route carries.

The tree pass declares extension keys and checks every written extension value against its schema and places.
