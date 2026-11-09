### The reply path

The endpoint turns the handler's result into a Starlette `Response` whose status, headers and body the boundary writes, with its own JSON encoding. It never uses a `response_model`, FastAPI's `jsonable_encoder` or a `JSONResponse` default. Content negotiation is not consulted. The boundary records each reply it writes (status, headers, a digest of the body) in the request scope, so the outgoing check can tell it from a reply the app wrote.
