---
"@seampact/server-runtime": patch
---

AdonisJS 6 servers answer a gzip body over the route limit once inflated with 413, where they answered 400 before.
