### The outgoing response check

The boundary wraps `send` for each contract request. It holds `http.response.start` until the verdict, then passes the messages on. The verdict rules, the `responses` modes, `bodyValidation` and the completion of the idempotency record are ADR 0016's, as ADR 0023 applies them:

- **A declared success** the boundary wrote passes. Its body chunks keep the writer's pace (spike: three chunks 300 ms apart arrived at 7, 308 and 610 ms).
- **An undeclared status** is a violation before any byte is sent, streams included.
- **A declared error** is held up to `MAX_CHECKED_ERROR_BODY_BYTES = 65536` and checked for the api's format and a listed code. A `gzip` or `deflate` body is decoded first. A `br` body is a violation: Python's standard library cannot decode it (a parity gap listed in Consequences).
- **A reply the boundary did not write.** A success status (a 2xx or a 304) is a violation. Once the access dependency admitted the request, a reply that is neither the boundary's nor a contract exception's is a violation.
- **An ETag** the boundary did not set is stripped, and a 304 it did not write is a violation (`frameworkEtag: strip`, the default).
- **A changed reply.** A middleware between the boundary and the endpoint can change the reply. The boundary compares the status and the body with what it recorded, a body that a later layer compressed (`GZipMiddleware`) decoded first, and judges a different one as a reply it did not write.

Under `strict` a violation is replaced by the api's 500, and `onUnexpectedError` is called. A failure inside a stream, after the head went out, cannot be replaced: it is logged, `onUnexpectedError` is called and the body ends short. Under `warn` the reply goes out as written, and the violation is logged once.

A reply written by a middleware outside the boundary is not seen; the boot check refuses one, and so does the first-request fallback. An ASGI wrapper around the app object itself (`app = CORSMiddleware(FastAPI())`, an error tracker's ASGI wrapper, a parent Starlette app's middleware) runs before step 1 and is not seen either: the boot check reads only `app.user_middleware`. The FastAPI guide says so.
