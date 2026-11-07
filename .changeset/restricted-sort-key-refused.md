---
"@seampact/codegen-core": patch
---

Django REST framework now refuses a sort key restricted by a right at generation, as every other server does (`paging.sortKey.right.unsupported`), instead of generating it without the right; the 1.0 release notes list this refusal and the Node servers' refusal of an input field right below the top level.
