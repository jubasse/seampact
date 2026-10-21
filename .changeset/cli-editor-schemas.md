---
"@seampact/cli": patch
"@seampact/compiler": patch
---

`seampact compile --editor-schemas` writes the workspace's editor schemas to `workspace.editorSchemas` (`.seampact/schemas` by default), so an editor flags a misspelt identity, right, requirement, enum, error code, paging style or schema name and offers the declared ones.
