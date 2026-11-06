---
---

The FastAPI, DRF and Ninja servers now write a deprecated route's Deprecation, Sunset and successor Link headers and the ETag of an item versioned by `If-Match`, and a paging style's header writes a boolean as `true` or `false` and is refused by name when it renders an object or an array, instead of being dropped.
