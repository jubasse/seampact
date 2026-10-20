---
"@seampact/lint": patch
---

A new lint warning, `seampact/not-found-role`, flags a declared 404 code that sits beside the built-in not-found code on a route and proposes the `errorRoles: { notFound: <code> }` line.
