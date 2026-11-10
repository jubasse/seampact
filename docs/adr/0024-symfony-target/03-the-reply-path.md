### The reply path

Every result class is turned into the reply by the `kernel.view` listener, and every generated exception by the `kernel.exception` listener; both write the contract reply themselves:

- a `Response` with its status, headers and body, serialized by the boundary's own `json_encode` call (`JSON_THROW_ON_ERROR`, `JSON_UNESCAPED_SLASHES`, `JSON_UNESCAPED_UNICODE`, `JSON_PRESERVE_ZERO_FRACTION`), never the Serializer, a normalizer or a `JsonResponse` default;
- one path for a 2xx among several, the derived 304 with the boundary's strong ETag, an idempotent replay and every contract error.

Content negotiation is not consulted. A client's `Accept` and the request format change nothing that the contract does not say. The boundary records each reply it writes, so the outgoing check can tell it from a reply the app wrote.

**Idempotency** runs in the `kernel.controller` listener after step 8: a replayed reply takes the controller's place, so the handler never runs. The reply is settled at `kernel.response` once step 10 has checked it; a failure of that check releases the key, and so does any 5xx reply, the boundary's own 500 for an exception no role maps included, as on Laravel and Spring. The store is the service `seampact.<api key>.idempotency_store` (the bundle's `IDEMPOTENCY_STORE_SERVICE`), an alias the app sets per api to a service implementing `Seampact\Hooks\IdempotencyStore`; the boot check refuses an api with boundary-enforced idempotency and no store, or a store of the wrong type, on both PHP targets.

**Cache-Control**: Symfony's `ResponseHeaderBag` writes `Cache-Control` in its own order (`max-age=60, private`) and adds `no-cache, private` where the contract writes none, as on Laravel; the directives are the same as on the other targets.
