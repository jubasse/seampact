---
"@seampact/server-runtime": patch
---

AdonisJS servers answer a request body in an unknown content coding with 415 and a corrupt or cut gzip body with 400, where they answered 500 before.
