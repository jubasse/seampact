---
"@seampact/codegen-core": patch
"@seampact/server-runtime": patch
---

The Node servers now write a deprecated route's Deprecation, Sunset and successor Link headers and the ETag of an item versioned by `If-Match`, answer a write with a missing or empty `If-Match` with 428, and, like the Python servers, accept the tag strong or weak (`W/"7"`, as a compressing server sends it back) and hand the handler the version unquoted.
