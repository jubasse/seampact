---
"@seampact/compiler": patch
---

The tree pass writes each operation of the api tree with its id, name, surface, resource, method and declared input, including form and multipart fields, refuses clashing operation ids, a collection without a singular, and misplaced or oversized files, and exports `treeNodesOperationNames`, `treeNodesFieldWire` and the `TreeNodesOperationName` type.
