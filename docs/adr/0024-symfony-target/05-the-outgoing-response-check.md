### The outgoing response check

The `kernel.response` listener checks the reply of each contract route. That reply comes from whichever writer:

- the boundary's own results and exceptions;
- the app's `kernel.exception` listeners and `ErrorListener`, in HTML or, with the Serializer installed and a JSON request format, in problem+json (spike);
- the firewall's entry points and handlers;
- a handler that returned its own `Response`, `JsonResponse`, `StreamedResponse` or `BinaryFileResponse`, for which Symfony dispatches no `kernel.view`.

The verdict rules, the `responses` modes, `bodyValidation` and the completion of the idempotency record are ADR 0016's, applied as ADR 0023 "The outgoing response check" applies them on the same HttpFoundation:

- **A declared success** that the boundary wrote passes. A streamed success comes only from a generated result (a download, which waits for a consumer), passed with its callback wrapped only to catch a failure.
- **An undeclared status** is a violation before any byte is sent, streams included.
- **A declared error** is held up to `MAX_CHECKED_ERROR_BODY_BYTES = 65536` and checked for the api's format and a listed code. A body in `gzip` or `deflate` is decoded first; a `br` error body is a violation, a parity gap listed in Consequences. A streamed error body is buffered by running its callback into the held bytes before the verdict, and the reply is then replaced by a `Response` holding those bytes, since a `StreamedResponse` refuses `setContent()` and its callback runs once. A `BinaryFileResponse` error body is read from its file, at most one byte past the cap, and replaced the same way.
- **A reply the boundary did not author.** On a contract route:
  - a success status (a 2xx or a 304) that the boundary did not write is a violation: a handler that returned its own `JsonResponse` (spike) or its own stream;
  - once the `kernel.controller` listener admitted the request, a reply that is neither the boundary's nor the rendering of an exception is a violation.
- **An ETag** that the boundary did not set is stripped, and a 304 that it did not write is a violation (`frameworkEtag: strip`, the default). `#[Cache(etag: ...)]` on a contract method sets its ETag on the boundary's reply object during `kernel.response`, before the check (not run), so the boundary compares the header with the value it wrote.
- **A changed authored reply.** The boundary recognises its reply by object identity, and later listeners can change that object. It records the status and the body bytes it wrote and judges a reply whose status or body differs as one it did not author. On `HEAD`, `ResponseListener` empties the body in `Response::prepare()` before the check, so only the status is compared (spike). The same holds for the boundary's own refusals, the catch-all 404 and the api's 500: an app listener that changes their status, media type or body gets the api's 500; headers it adds stay.

Under `strict` a violation is replaced by the api's 500, and `onUnexpectedError` is called. A failure inside a stream's callback, after the headers are sent, cannot be replaced: it is logged, `onUnexpectedError` is called and the body ends short. Under `warn` the reply goes out as written, and the violation is logged once.

The limits are those of ADR 0016: a writer that bypasses the response (`echo` from the handler, `header()`, `exit` or `die`, `dd()`) is not seen. An exception thrown inside `Response::send()` or by a `kernel.response` listener after the check is not seen either. A reply set by an app `kernel.request` listener placed above 512, or changed by an app `kernel.response` listener placed below -2048, escapes the check; the boot check refuses both when they are registered in the container, and a listener the app adds at run time with `addListener()` is not seen. An `HttpCache` that the front controller wraps around the kernel by hand (`new HttpCache($kernel)`, the recipe before Symfony 6) serves stored replies without the boundary and is not seen either; the boot check sees only `framework.http_cache`, and the Symfony guide says so. The profiler's `ProfilerListener` (`kernel.response` at -100) captures the reply before the check, so the profiler shows the reply as written, not the 500 that replaces a violation; the guide says so too.
