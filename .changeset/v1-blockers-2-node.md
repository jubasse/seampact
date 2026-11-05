---
"@seampact/server-runtime": patch
---

A request body with a lone surrogate in a string value or a key is now refused as a `schemaInvalid` type issue on every Node server, as the PHP and Python servers do.
