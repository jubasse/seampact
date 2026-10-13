---
"@seampact/compiler": patch
---

The tree pass writes each operation of the api tree with its id, name, surface, resource, method and declared input, including form and multipart fields, refuses clashing operation ids, a collection without a singular, and misplaced or oversized files, and exports `treeNodesOperationNames`, `treeNodesFieldWire` and the `TreeNodesOperationName` type.

The tree pass also writes the api with its surfaces and path versions, the written conventions, lint, packs and services, and each operation's path, declared parameters, unknown-query policy, declared responses and format, and refuses literal version segments, mismatched path parameters, duplicate parameters, opaque parameters, misplaced header-tagged unions, redirects with a body, ops missing their input or item, and member routes of a collection without id.
