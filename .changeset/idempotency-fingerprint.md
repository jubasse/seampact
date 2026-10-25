---
"@seampact/codegen-core": patch
---

A retry with the same idempotency key now replays the first reply after a token or session refresh, on every Node server and on Spring Boot, since the request fingerprint no longer digests the Authorization, CSRF or other credential headers; a retry with a new `traceparent` or deadline header now replays too, since only the header params the contract declares and a union tag are digested.

An error reply marked `Cache-Control: no-store` is no longer kept for an idempotent replay on every Node server and on Spring Boot, so a retry runs the operation again, while a `no-store` success is still replayed.

Spring Boot now refuses a request body sent with more than one `Content-Encoding` with 415, as the Node servers do.
