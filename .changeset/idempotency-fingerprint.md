---
"@seampact/codegen-core": patch
---

A retry with the same idempotency key now replays the first reply after a token or session refresh, on every Node server and on Spring Boot, since the request fingerprint no longer digests the Authorization, CSRF or other credential headers.

A reply marked `Cache-Control: no-store` is no longer kept for an idempotent replay on every Node server and on Spring Boot, so a retry runs the operation again.
