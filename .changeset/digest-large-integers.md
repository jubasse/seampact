---
---

Python, Laravel and Symfony servers compute the ETag and idempotency digests of a body holding an integer past 2^53 as the other targets do, so the same body gets the same digest on every server; after the upgrade, a retry of such a request stored by 1.0.0 no longer matches its record and is served as a new request.
