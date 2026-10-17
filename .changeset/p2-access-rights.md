---
"@seampact/compiler": patch
---

The compiler checks the access catalogues and resolves each operation's scopes and ordered requirements, with their subjects.
The compiler also lists each operation's field rights, the rights of its sort keys and its filteredBy right.
The compiler refuses a field restriction that no field right could enforce: two at one pointer, one below a JSON text field, a query parameter, a header or error params, or more than 1000 for one operation.
The compiler adds each rule proof to the route's input or headers once, creates a proof-only input on a POST action without one, and refuses a body proof without a body, a proof name clash, a signed route without input and a bucket key the route cannot fill.
