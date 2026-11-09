### Errors raised before the boundary

Before the boundary, the ASGI server, any ASGI wrapper around the app object and `ServerErrorMiddleware` run: the server's own limits (uvicorn's `--limit-concurrency` 503, its header limits), what such a wrapper answers, and an exception the boundary itself raises. Between the boundary and the endpoint, the app's inner middleware and its global and router dependencies refuse by raising `HTTPException` or by answering. Their replies are mapped as "Exceptions on contract routes" says.
