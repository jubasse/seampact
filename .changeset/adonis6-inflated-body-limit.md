---
"@seampact/server-runtime": patch
---

AdonisJS 6 servers answer a compressed request body with 415, or 413 when it is over the route limit once inflated, where they answered 400 before.
