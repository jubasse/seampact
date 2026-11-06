---
---

Spring Boot now writes a deprecated route's Deprecation, Sunset and successor Link headers and the ETag of an item versioned by `If-Match`, answers a write with a missing or empty `If-Match` with 428 instead of 400, accepts the tag strong or weak (`W/"7"`) and hands the handler the version unquoted, as the Node and Python servers do.
