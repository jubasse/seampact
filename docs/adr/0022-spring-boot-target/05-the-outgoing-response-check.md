### The outgoing response check

The filter wraps the response of each contract route in a checking wrapper. Every byte of the reply goes through it, from whatever writer:

- the reply handler;
- an app `@ControllerAdvice`;
- Spring Security's entry point and access-denied handler;
- a `StreamingResponseBody` written on a task thread;
- an asynchronous dispatch.

On an `ASYNC` dispatch, Spring passes its own `LifecycleHttpServletResponse` down the chain rather than the wrapper. The filter therefore finds the wrapper through a request attribute, and completes the check when the last dispatch returns without starting another (spike). The verdict rules, the `responses` modes, `bodyValidation` and the completion of the idempotency record are ADR 0016's, with one departure: under `bodyValidation` the target also validates the body it writes from a handler result, a 500 under `strict` and sent and logged under `warn`, where ADR 0016 never validates it (listed in Consequences):

- **A declared success** passes chunk by chunk.
  - The wrapper flushes when the writer flushes. Spring Framework 7 ignores `flush()` on a `StreamingResponseBody`'s stream unless the flag `spring.http.response.flush.enabled` is `true`, with or without the wrapper (spike). Since Framework 7.0.6 it is a `SpringProperties` flag, read by `ServletServerHttpResponse`: a JVM system property (`-D`) or a classpath `spring.properties`, never Boot's `application.properties`.
  - The target does not set that flag. The download docs show both ways to set it.
- **An undeclared status** is a violation as soon as the first byte or the commit shows it; nothing has reached the client.
- **A declared error** is held up to `MAX_CHECKED_ERROR_BODY_BYTES = 65536` and checked for the api's format and a listed code. A body in `gzip` or `deflate` is decoded first. A `br` error body, which the JDK cannot decode, is a violation; ADR 0016 decodes it, a parity gap listed in Consequences.
- **`sendError`, and an empty refusal**: a 401, 403 or 429 set with `setStatus` that ends with no body byte is mapped like `sendError`. Under `strict`, neither reaches the container's error page or Boot's `/error`:
  - 401, 403 and 429 answer their role's reply in the api's format when the operation declares that status, keeping the headers already set (`WWW-Authenticate`);
  - any other status is checked as an error without a body, a violation.
  `sendError` covers Spring Security's `AccessDeniedHandlerImpl`, its firewall's `RequestRejectedException` handler, and Spring MVC's 405, 406 and 415. The empty refusal covers `HttpStatusEntryPoint`, and the resource server's `BearerTokenAuthenticationEntryPoint` and `BearerTokenAccessDeniedHandler`, which call `setStatus` only.
- **A reply the boundary did not author.** The interceptor marks the requests it admits, the reply handler the replies it writes, and the exception resolver every exception it sees, those it leaves to the app's resolvers included. On a contract route:
  - a success status (a 2xx or a 304) that the reply handler did not write is a violation as soon as its first byte or the commit shows it: a handler that wrote to the response itself, or a router function, an actuator endpoint or an app `HandlerMapping` that took the route;
  - once the interceptor admitted the request, a reply that completes with neither the reply handler's nor the exception resolver's mark is a violation. The reply handler treats a `null` value as a violation.
- **An ETag** that the boundary did not set is stripped, and a 304 that it did not write is a violation (`frameworkEtag: strip`, the default). An app's `ShallowEtagHeaderFilter` ordered inside the boundary filter is therefore stripped; one ordered before it fails the boot check.

An exception that escapes `chain.doFilter`, on the `REQUEST` or the `ASYNC` dispatch of a contract route, is caught by the filter and never reaches the container. Before the commit, the filter writes the api's 500 and calls `onUnexpectedError` with it; after the commit, it fails as a stream does below. The filter is therefore not registered for the `ERROR` dispatch.

Under `strict` a violation is replaced by the api's 500 when the response is not committed, and `onUnexpectedError` is called. A failure after the commit (a stream whose writer throws after its first bytes) cannot be replaced: it is logged, `onUnexpectedError` is called and the connection is closed. Under `warn` the reply goes out as written, and the violation is logged once. A handler result that breaks its own type (null, not an arm of its result, a null list, table or page, a page without items or with a negative total) is the api's 500 in both modes, as on the Node targets.

Until a consumer needs streamed bodies, the wrapper holds every reply whole in memory, success included, and an error body is neither bounded by `MAX_CHECKED_ERROR_BODY_BYTES` nor decoded from `gzip` or `deflate`: such a body fails the check as not JSON.

The limits are those of ADR 0016: a writer that bypasses the response (the raw socket) is not seen. A reply that an app filter ordered before the boundary filter writes is not seen either; the boot check refuses such a filter only for `ShallowEtagHeaderFilter`, `FormContentFilter`, `HiddenHttpMethodFilter` and Spring Security's chain.
