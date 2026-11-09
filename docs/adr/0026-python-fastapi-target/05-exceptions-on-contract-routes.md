### Exceptions on contract routes

The generated exceptions of an api derive from its contract base (`TasksContractError`). `bind_<api>()` registers one handler for that base with `add_exception_handler`. It renders the code on a contract request of its own api. Elsewhere it re-raises, so the app's own error handling applies.

An `HTTPException` is rendered inside Starlette's stack, so the boundary sees only the reply (spike). Starlette picks a handler by status code first, then by the nearest class of the exception. `bind_<api>()` therefore wraps every entry of `app.exception_handlers` that can take an `HTTPException`: a key that is Starlette's `HTTPException`, FastAPI's, or a subclass of either, and every integer status key, with FastAPI's default handler kept when the app set none. Each wrapper records the exception in the request scope and then calls the app's handler. The app's rendering stays on its own routes. An app handler for `fastapi.HTTPException` or for `401` took the exception before a wrapper on Starlette's class alone saw it (review probe), hence every entry. On a contract route, the boundary reads the record and answers with the role of the status:

- 401: `unauthenticated`, as FastAPI's `OAuth2PasswordBearer` and `HTTPBearer` raise it;
- 403: `forbidden`;
- 404: `notFound`;
- 413: `payloadTooLarge`;
- 429: `rateLimited`, keeping `Retry-After`;
- 503: `serviceUnavailable`, keeping `Retry-After`.

Each answers by ADR 0023's rule: the code of its role when the operation declares one; else the operation's single code of that status; with the params its role binding renders, or none when the code requires none; else the api's 500, logged. An access hook that raises an `HTTPException` keeps its role. Any other reply the boundary did not write, a `RequestValidationError` 422 of an app dependency included, is checked as written by the outgoing check.

Any other exception crosses the boundary (spike): it answers the api's 500, logs it and calls `onUnexpectedError`, in every `responses` mode. Under `app.debug` only, it sends nothing and re-raises after its log line, so Starlette's debug page shows the traceback. The log line and the listener's reason name the exception's class and where it was raised; its message, which may carry an input value, only under `app.debug`.
