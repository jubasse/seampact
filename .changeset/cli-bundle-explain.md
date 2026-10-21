---
"@seampact/cli": minor
"@seampact/compiler": patch
"@seampact/spec": patch
---

`seampact bundle` writes a contract's bundle with the integrity value to pin (vendoring packs linked into `node_modules`, refusing a workspace with `workspace.imports`), and `seampact explain <api>.<operationId>` prints an operation with where each part comes from.
