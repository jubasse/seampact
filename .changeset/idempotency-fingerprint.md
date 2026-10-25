---
"@seampact/codegen-core": patch
---

A retry with the same idempotency key now replays the first reply after a token or session refresh, on every Node server and on Spring Boot, since the request fingerprint no longer digests the Authorization, CSRF or other credential headers.
