---
---

The Symfony target exports a request matcher per access kind and an access table for `access_control` and voters, answers a 401, 403 or 429 `HttpException` with the api's error replies, and serves absolute URLs from the bundle's `public_origin`.
