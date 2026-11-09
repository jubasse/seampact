### Query and bounded values

- **Query.** Decoded from the raw `QUERY_STRING` by the IR's wire form, with form decoding (`+` is a space), never from `$request->query`, since PHP's `parse_str` turns `.` and spaces in a name into `_` and reads `a[]` as an array. Zero body bytes is no body. The media type is matched exactly.
- **Body limit.** The boundary refuses a declared `Content-Length` above the route's limit before reading. It reads the body in chunks through `getContent(true)`, decodes `gzip` and `deflate` with ext-zlib's `inflate_add`, counts both the encoded and the decoded bytes, and answers the route's 413 as soon as either passes the limit, chunked bodies included (spike, CLI server).
  - Any other content coding answers 415; a corrupt compressed body is the client's 400.
  - The boundary's input, and a signed route's raw body, are the decoded bytes.
  - The web server's limit and `post_max_size` must be at least the largest route limit; the Symfony guide says so. The target exports no limit constant.
- **Paging.** The paging roles, `overLimit` included, are validated in step 6. Symfony has no paginator of its own, so no paging style of a pack applies; the handler answers the contract's page shape.
- **Throttle.** The throttle hook reads its bucket through a RateLimiter factory service that the app configures (`framework.rate_limiter`), keyed by the boundary's bucket key (symfony-3).
- **Keys.** The throttle bucket key and the idempotency key are fixed-size SHA-256 digests with the same bytes, hex and base64url text as the Node, Spring and Laravel targets, so keys and ETags are equal across targets. The idempotency key is derived as ADR 0012 obligations say, never from the credentials.
- **Version tokens.** The boundary validates the expected version with the body; the handler compares it with the stored version and answers the operation's `stateConflict` error, as on the other targets.
- **Absolute URLs.** Under `api.wire.urls: absolute`, every URL starts with the configured public origin, the bundle's `public_origin` value ("Options and registration"). The request host and forwarded headers are never read. Trusted proxies stay the app's own `framework.trusted_proxies` and `trusted_headers` settings; they change Symfony's URL generator, never the boundary.
