### The reply path

Every result class implements `Responsable` and every generated exception has a `render()` method; both write the contract reply themselves:

- a `Symfony\Component\HttpFoundation\Response` with its status, headers and body, serialized by the boundary's own `json_encode` call (`JSON_THROW_ON_ERROR`, `JSON_UNESCAPED_SLASHES`, `JSON_UNESCAPED_UNICODE`, `JSON_PRESERVE_ZERO_FRACTION`), never an API Resource, a `JsonResponse` default or the app's macros;
- one path for a 2xx among several, the derived 304 with the boundary's strong ETag, an idempotent replay and every contract error.

Content negotiation is not consulted. A client's `Accept` changes nothing that the contract does not say. The boundary marks each reply it writes, so the outgoing check can tell it from a reply the app wrote.
