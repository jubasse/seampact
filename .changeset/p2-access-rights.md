---
"@seampact/compiler": patch
---

The compiler writes the `rights`, `rules`, `scopes` and `buckets` catalogues and, per operation, the resolved `scopes` and the ordered `requires` (pack-derived, then inherited, then the route's own), and reports undeclared or misnamed rights, wrong params or subjects, a scope entered twice, an equal requirement twice, a non-guest right on a public route and a service route without its caller right.
