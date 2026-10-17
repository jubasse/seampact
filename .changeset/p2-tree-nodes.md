---
"@seampact/compiler": patch
---

The tree pass writes each operation of the api tree with its id, name, surface, resource, method and declared input, including form and multipart fields, refuses clashing operation ids, a collection without a singular, and misplaced or oversized files, and exports `treeNodesOperationNames`, `treeNodesFieldWire` and the `TreeNodesOperationName` type.

The compiler now writes the api with its surfaces and path versions, its conventions, lint settings, packs and services, and each operation's path, parameters, unknown-query policy, responses and format, and reports a located error for a label version on a versioned surface, a literal version segment, a placeholder no parameter fills or one written twice, a path that is not relative segments, two operations on one method and path, a parameter or response header declared twice, a query field named like a path parameter or with no query encoding, an opaque value or a file outside the body, a header-tagged union's header declared again, a fields map naming no object schema, an item without its id property, a body limit too large to check, a redirect with a body, a 204 with a body, responses written beside output, a response description, ops missing their input or item, and member routes of a collection without an id.
