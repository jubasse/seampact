---
---

The Laravel and Symfony targets now write a deprecated route's Deprecation, Sunset and successor Link headers and the ETag of an item versioned by `If-Match`, answer a write with a missing or empty `If-Match` with 428, accept the tag strong or weak (`W/"7"`) and hand the handler the version unquoted, and refuse a page header written from an object or a list (`paging.response.header.unsupported`) instead of dropping it.
