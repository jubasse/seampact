---
"@seampact/codegen-core": patch
"@seampact/openapi": patch
"@seampact/compiler": patch
---

An error code without a written `title` now sends no `title` member instead of repeating the code, and the OpenAPI document no longer lists one for it.
A list with no paging style now fails with a fix that shows a short page-numbers style and `paging: none`.
