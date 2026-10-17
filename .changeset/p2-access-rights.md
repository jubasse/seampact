---
"@seampact/compiler": patch
---

The compiler checks the access catalogues and resolves each operation's scopes and ordered requirements, with their subjects.
The compiler also lists each operation's field rights, the rights of its sort keys and its filteredBy right.
The compiler refuses a field restriction that no field right could enforce: two at one pointer, one below a JSON text field, a query parameter, a header or error params, or more than 1000 for one operation.
