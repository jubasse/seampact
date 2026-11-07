---
---

Python, Laravel and Symfony servers compute the ETag and idempotency digests of a body holding an integer past 2^53 as the other targets do, so the same body gets the same digest on every server.
