### Query and bounded values

The rules of ADR 0023 "Query and bounded values" hold, with these Python details:

- **Query.** Decoded from the raw `query_string` by the IR's wire form, with form decoding, never from `request.query_params`.
- **Body limit.** The boundary refuses a declared `Content-Length` above the route's limit before reading. It reads the `http.request` messages, decodes `gzip` and `deflate` with `zlib`, counts the encoded and the decoded bytes, and answers the route's 413 as soon as either passes the limit. Any other content coding answers 415; a corrupt compressed body is the client's 400.
- **Paging, deadlines, relays, keys, version tokens and absolute URLs** come from the shared runtime, as on the other targets. The public origin is the `public_origin` argument of `bind_<api>()`; the request host and forwarded headers are never read.
- **Order.** The input dependency reads a versioned write's version before the header check, so a missing `If-Match` answers `preconditionRequired` (428), never `schemaInvalid`; then it fills the paged limit, builds the typed input, applies the input field rights, checks the deadline and claims the idempotency key, a stored reply answering without the handler. The boundary completes the claim with the reply before its last message, and releases it when the request fails.
- **Several apis.** Each `bind_<api>()` adds its own boundary. Each boundary accepts the other apis' boundaries outside it, unless one claims this api's paths with its `catchAll` on.
