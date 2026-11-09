### The outgoing response check

The boundary middleware checks the reply of each contract route as it returns through the global stack. That reply comes from whichever writer:

- the boundary's own results and exceptions;
- the app's exception handler and its `render` and `respond` callbacks;
- a native layer's refusal;
- a handler that returned its own `Response`, `JsonResponse` or `StreamedResponse`.

The verdict rules, the `responses` modes, `bodyValidation` and the completion of the idempotency record are ADR 0016's:

- **A declared success** that the boundary wrote passes. A streamed success comes only from a generated result (a download, which waits for a consumer). A `StreamedResponse` carries its status and headers before its callback runs, so the boundary's declared streamed success is passed with its callback wrapped only to catch a failure: the chunks keep the writer's pace (spike, CLI server).
- **An undeclared status** is a violation before any byte is sent, streams included (spike).
- **A declared error** is held up to `MAX_CHECKED_ERROR_BODY_BYTES = 65536` and checked for the api's format and a listed code. A body in `gzip` or `deflate` is decoded first; a `br` error body, which PHP's zlib extension cannot decode, is a violation, a parity gap listed in Consequences. A streamed error body is buffered by running its callback into the held bytes before the verdict.
- **A reply the boundary did not author.** On a contract route:
  - a success status (a 2xx or a 304) that the boundary did not write is a violation: a handler that returned its own `response()->json()` (spike) or its own `StreamedResponse`;
  - once the access middleware admitted the request, a reply that is neither the boundary's nor a contract exception's rendering is a violation.
- **An ETag** that the boundary did not set is stripped, and a 304 that it did not write is a violation (`frameworkEtag: strip`, the default). Laravel's `cache.headers:etag` middleware adds its own ETag to the boundary's reply object (spike), so the boundary compares the header with the value it wrote.
- **A changed authored reply.** The boundary recognises its reply by object identity, and later middleware or listeners can change that same object. It records the status and the body bytes it wrote, as it records the ETag, and judges a reply whose status or body differs as one it did not author.

Under `strict` a violation is replaced by the api's 500, and `onUnexpectedError` is called. A failure inside a stream's callback, after the headers are sent, cannot be replaced: it is logged, `onUnexpectedError` is called and the body ends short. Under `warn` the reply goes out as written, and the violation is logged once.

The limits are those of ADR 0016: a writer that bypasses the response (`echo` from the handler, `header()`, `exit` or `die`, and `dd()`, whose VarDumper output goes out with a 500 before the process exits) is not seen. An exception thrown inside `Response::send()` itself, after every middleware has returned, is rendered by Laravel's own error page (spike). A reply written by a global middleware the app prepends before the boundary is not seen either; the boot check refuses one, and so does the boundary's first-request assertion.
