---
"@seampact/compiler": patch
---

Write every pack file in the source-location side table as `.packs/<name>@<version>/<path>`, the path the bundle vendors it under, so a pack installed in a `node_modules` above the workspace root compiles and the table no longer depends on the package manager's layout.
