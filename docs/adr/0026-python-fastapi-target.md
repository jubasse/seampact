# ADR 0026: The Python core and the FastAPI target

Status: accepted

## Context

[A48](../decisions.md#a48) puts the Python targets in v1: FastAPI, Django REST Framework and Django Ninja, on a shared Python core. ADR 0012 fixes what every server target generates around the developer's handlers. ADR 0016 fixes the rules a target meets: the check order, a reply written by the boundary, exceptions handled narrowly, the outgoing response check, the body limit and the boot check. ADR 0010 "The Python channels" fixes how a Python build gets the binary.

This ADR states two things. First, the Python core: the distributions, the versions, sync and async code, the hook protocols, and what the PHP core gave it. ADR 0027 builds the Django targets on the same core. Second, the FastAPI target: `seampact-fastapi` generates, per api of the app config, Python that places the checks around the developer's handlers in a FastAPI app. `seampact generate` runs it with pip only, and the app builds on a machine without Node ([A9](../decisions.md#a9)). What this ADR does not restate holds as ADR 0016 and ADR 0023 say.

Seven FastAPI and Starlette behaviours shape the placement (spike):

- Starlette builds its middleware stack once, at the first ASGI call: `ServerErrorMiddleware`, then the app's `user_middleware`, then `ExceptionMiddleware`, then the router. `add_middleware` inserts at the front of `user_middleware`, so the last one added is the outermost. Adding one after start raises.
- Dependencies run in a fixed order: the app's global dependencies, the router's, the route's `dependencies`, then the endpoint's parameters in signature order. A `def` dependency runs in the threadpool. A parameter error does not stop the others: FastAPI resolves every sibling, skips only a dependency whose own sub-dependency failed, and answers 422 before the endpoint. FastAPI caches a dependency per request, and `app.dependency_overrides` replaces any dependency in the tree.
- `ExceptionMiddleware` renders an `HTTPException` inside the stack. An outer middleware sees the reply, never the exception. Any other exception crosses the user middleware on its way to `ServerErrorMiddleware`.
- Starlette decodes the path before routing (`scope["path"]`) and keeps the raw one (`scope["raw_path"]`). Its router redirects a path with a trailing slash (307, `redirect_slashes`).
- FastAPI parses and validates the parameters an endpoint declares, in Pydantic's lax mode, and answers 422. An endpoint that declares none gets no parsing.
- The server sends `lifespan.startup` before the first request. uvicorn exits when the app answers `lifespan.startup.failed`. `TestClient` runs the lifespan only inside `with`.
- Pydantic's strict mode refuses `1.0` for an `int`, and, on Python objects, a string for a `datetime`, a `date`, a `UUID`, a `Decimal` or an enum.

## Options

- Python core: a port of the PHP core, or a core designed for Python. Choice: designed for Python, keeping only the PHP ideas that fit ("From the PHP core" below).
- Step 1 and the outgoing check: Starlette's `BaseHTTPMiddleware`, a custom `APIRoute` class, or a pure ASGI middleware placed outermost. Choice: the pure ASGI middleware. It sees the raw path before routing, every message of every reply, streams at their own pace, and every exception the app does not handle. `BaseHTTPMiddleware` hands over a rebuilt `Response`, and a route class runs after routing.
- Steps 2 to 5: in the boundary middleware, or in a route dependency. Choice: the route dependency. FastAPI resolves it after the app's global and router dependencies, so a hook can reuse what they resolved (a database session, a `Security` scheme) from FastAPI's per-request cache. It runs after them, not only once they passed: FastAPI keeps resolving after a parameter error and answers 422 at the end ("Placement").
- Step 6: FastAPI's own parameter parsing, or Pydantic on the boundary's decoded tree. Choice: the decoded tree. FastAPI's parsing is lax (`"5"` becomes `5`), answers 422, and never sees the raw body the boundary bounded and decoded.
- Handlers: decorated functions, or a `typing.Protocol` per resource implemented by a class the app builds in a FastAPI dependency. Choice: the protocol. The generated route keeps its own signature, so FastAPI parses nothing, and `Depends` and `dependency_overrides` still reach the handler's own dependencies (spike).
- Boot check: when `bind_<api>()` runs, on the first request, or on `lifespan.startup`. Choice: on `lifespan.startup`, after the app's own startup code, with a first-request fallback for a server or test client that runs no lifespan. At bind time the app may still add routes and middleware.

## Decisions

Each section lives in its own file under the folder named like this ADR, in the order of the table.

| Section | File | Contains |
|---|---|---|
| Python core | [0026-python-fastapi-target/01-python-core.md](0026-python-fastapi-target/01-python-core.md) | Distributions; The binary and the root project; Versions; Sync and async; Hook protocols; Naming; From the PHP core |
| Placement | [0026-python-fastapi-target/02-placement.md](0026-python-fastapi-target/02-placement.md) |  |
| Routes | [0026-python-fastapi-target/03-routes.md](0026-python-fastapi-target/03-routes.md) |  |
| The reply path | [0026-python-fastapi-target/04-the-reply-path.md](0026-python-fastapi-target/04-the-reply-path.md) |  |
| Exceptions on contract routes | [0026-python-fastapi-target/05-exceptions-on-contract-routes.md](0026-python-fastapi-target/05-exceptions-on-contract-routes.md) |  |
| The outgoing response check | [0026-python-fastapi-target/06-the-outgoing-response-check.md](0026-python-fastapi-target/06-the-outgoing-response-check.md) |  |
| Errors raised before the boundary | [0026-python-fastapi-target/07-errors-raised-before-the-boundary.md](0026-python-fastapi-target/07-errors-raised-before-the-boundary.md) |  |
| Types and validation | [0026-python-fastapi-target/08-types-and-validation.md](0026-python-fastapi-target/08-types-and-validation.md) |  |
| Query and bounded values | [0026-python-fastapi-target/09-query-and-bounded-values.md](0026-python-fastapi-target/09-query-and-bounded-values.md) |  |
| Redaction | [0026-python-fastapi-target/10-redaction.md](0026-python-fastapi-target/10-redaction.md) |  |
| Options and registration | [0026-python-fastapi-target/11-options-and-registration.md](0026-python-fastapi-target/11-options-and-registration.md) |  |
| The boot check | [0026-python-fastapi-target/12-the-boot-check.md](0026-python-fastapi-target/12-the-boot-check.md) |  |
| Native security layers | [0026-python-fastapi-target/13-native-security-layers.md](0026-python-fastapi-target/13-native-security-layers.md) |  |
| Native access instead of hooks | [0026-python-fastapi-target/14-native-access-instead-of-hooks.md](0026-python-fastapi-target/14-native-access-instead-of-hooks.md) |  |
| What the shape-imposing features turn off with | [0026-python-fastapi-target/15-what-the-shape-imposing-features.md](0026-python-fastapi-target/15-what-the-shape-imposing-features.md) |  |
| Native docs | [0026-python-fastapi-target/16-native-docs.md](0026-python-fastapi-target/16-native-docs.md) |  |
| Links and the client | [0026-python-fastapi-target/17-links-and-the-client.md](0026-python-fastapi-target/17-links-and-the-client.md) |  |
| What the generated code depends on | [0026-python-fastapi-target/18-what-the-generated-code-depends.md](0026-python-fastapi-target/18-what-the-generated-code-depends.md) |  |
| Refused by name or waiting | [0026-python-fastapi-target/19-refused-by-name-or-waiting.md](0026-python-fastapi-target/19-refused-by-name-or-waiting.md) |  |
| The consumer and the proof | [0026-python-fastapi-target/20-the-consumer-and-the-proof.md](0026-python-fastapi-target/20-the-consumer-and-the-proof.md) |  |
| Delivery | [0026-python-fastapi-target/21-delivery.md](0026-python-fastapi-target/21-delivery.md) |  |

## Spike

Run on CPython 3.12.16 with uvicorn 0.54.0, hypercorn 0.18.0 and httpx 0.28.1, in two environments, and not kept: FastAPI 0.162.0 with its floor Starlette 0.46.0 and Pydantic 2.9.0 (pydantic-core 2.23.2), and FastAPI 0.162.0 with Starlette 1.10.0 and Pydantic 2.14.2 (pydantic-core 2.50.2). Every row gave the same result in both. A reduced placement had a pure ASGI boundary added last, a router with a route dependency and an endpoint-parameter dependency, a `def` handler factory depending on `get_db`, and a streamed route. Requests went through `TestClient`, and through raw sockets to uvicorn and hypercorn.

| Case | Result |
|---|---|---|
| dependency order | app global, router, route `dependencies`, then endpoint parameters in signature order, then the endpoint |
| `HTTPException(401)` from an app global dependency | rendered inside by `ExceptionMiddleware`; the boundary saw a 401 reply and no exception. With the app's handler wrapped before the stack was built, the boundary read `HTTPException 401` from the request scope |
| an exception from a handler | crossed the boundary, which answered its 500 |
| `scope["route"]` | set by the router on both Starlette versions; `/v1/tasks/%73earch` chose the search route while the raw match was `{task_id}` |
| boot check raising at the app's `lifespan.startup.complete`, under uvicorn | `lifespan.startup.failed` from Starlette, "Application startup failed. Exiting.", exit status 3 |
| the same under `with TestClient(app)`; answering `startup.failed` without raising | `TestClient` raised the boundary's error; `TestClient` hung, uvicorn exited 3 |
| `TestClient(app)` without `with`; `uvicorn --lifespan off` | no lifespan, requests served |
| `/v1/tasks/%73earch`, `a%2Fb`, `7%3Bx=1`, `%2e%2e`, `?x=%20+1&a.b=1` under uvicorn, hypercorn, `TestClient` | `raw_path` as sent, without the query; `path` decoded (`search`, `a/b`, `7;x=1`, `..`); `query_string` raw |
| an app route with a trailing slash; a contract path with one | 307 to the path without it; the boundary's 404 before routing |
| three chunks 300 ms apart through the wrapped `send`, start held until the verdict | at 7, 308 and 610 ms under uvicorn; 7, 308 and 609 ms under hypercorn |
| a malformed JSON body to an endpoint with only `Request` and dependencies | reached the endpoint, no 422 |
| `app.dependency_overrides[get_db]` | replaced the handler factory's own dependency; the `def` factory ran in a worker thread |
| `include_in_schema=False` | the contract routes were absent from `/openapi.json` |
| strict `int` on `1.0`; with a whole-number `BeforeValidator` | refused (`int_type`); `1.0` accepted as `1`, `1.5`, `true` and `"1"` refused |
| strict list on `{}`, dict on `[]`, model on `[]` and on `{}` | refused, refused, refused, accepted |
| strict, on Python objects, a string for `datetime`, `date`, `UUID`, `Decimal`, `StrEnum` | refused; accepted from JSON text |
| `model_fields_set` on `{}` and `{"note": null}` | empty; `note` |
| the 12 normalised patterns of the golden IRs under `rust-regex` | all compiled; `createdAt\n` and `a` U+00A0 `b` refused, `a` U+1F600 `b` accepted by `.` |
| `b` on `abc`; `\d` on U+0663; lookahead; backreference | matched (search); matched (Unicode); `SchemaError` when the model was built; `SchemaError` |
| a `def` hook through `run_in_threadpool`; an `async def` hook | a worker thread with the caller's context variables; the event loop thread |
| `add_middleware(CORSMiddleware)` after the boundary; after start | `CORSMiddleware` outside the boundary; `RuntimeError` |
| a Pydantic model with a generated `__repr_args__` hiding a member | `repr`, `str` and `__rich_repr__` printed `[redacted]` |

The review of this ADR ran more probes on the same two environments, with the same result on both:

| Case | Result |
|---|---|---|
| an app handler for `fastapi.HTTPException`, or for `401`, then Starlette's `HTTPException` handler wrapped; a dependency raises `fastapi.HTTPException(401)` | the app's handler answered; the wrapper was never called |
| a `/{full_path:path}` route or `app.mount("/v1", ...)` before the contract router; `GET /v1/tasks/7` | the catch-all or the mount answered 200 |
| the first `Match.FULL` over `app.routes` for a scope `GET /v1/tasks/x` | the catch-all, the `Mount`, or the entry holding the contract route when none of them exists |
| a router included, then a route added to it | the late route served; `app.routes` held no `APIRoute`; `scope["route"]` the original route |
| an app global dependency, then a hook factory, with a missing `Header()` | 422 after the access dependency, the input dependency and the factory ran; with the hook factory, the access dependency skipped |
| `HEAD` on an `APIRoute` registered for `GET` | 405 |
| `app.dependency_overrides` on the route and input dependencies | the endpoint reached, 200 |
| `TestClient(app, root_path="/api")` | `path` and `raw_path` without `/api`, `root_path` `/api` |

Starlette 1.10's `TestClient` warns that `httpx` is deprecated in favour of `httpx2`; fastapi-2 picks the client its tests use.

## Consequences

- App input rules ([ADR 0028](0028-app-input-rules.md)): FastAPI (1.1.x): step 8b runs in `featured_input` right after the claim, with `input_rules` in `bind_<api>()`; a refusal calls `abandon_idempotency` and clears `state.idempotency`.
- An app keeps its routes, its middleware, its dependencies, its exception handlers and its settings. On contract routes the boundary's checks and reply win.
- The app calls one function per api, last. A middleware added after it is refused at boot.
- Handlers are classes behind a protocol, not decorated functions; `Depends`, the per-request dependency cache and `dependency_overrides` still work. The FastAPI guide shows it first.
- FastAPI's 422 never answers on a contract route; the contract's 400 does.
- A `def` handler or hook runs in anyio's threadpool, shared with FastAPI's own `def` dependencies.
- A path value whose percent-decoding is not UTF-8, `%2F` in a segment and a dot segment answer the path's 404, as on Laravel.
- A `br` error body is a violation here, where ADR 0016 decodes it.
- `model_dump`, `asdict` and `json.dumps` show sensitive values; `repr`-based tools do not.
- Under `rules: native`, Pydantic's value rules give their own verdicts, listed in the FastAPI guide; patterns behave the same in both modes.
- An ASGI server without `raw_path` loses the raw-path rules; the boundary says so once at start.
- ADR 0012's target tables gain a fastapi row in the lead's follow-up: steps 1 and 10 in a pure ASGI middleware, steps 2 to 5 in a route dependency, steps 6 to 8 in an endpoint dependency.

## Traceability

- FRs: FR-5 (the check order), FR-14 (cases refused by name), FR-16 (server boundaries, handlers stay the developer's), FR-17 (distribution and the app config), FR-20 (signed webhooks), FR-21 (native targets, Python by A48), FR-25 (framework routes and the boot check), FR-35 (the shared suite), FR-40 (generated IR models); CHK-158, CHK-161, CHK-165, CHK-168; amendments A9, A36, A40, A41, A47, A48.
- ADRs: 0003 (the decoding and the patterns), 0007 (Python names), 0009 (artefacts, `rules`, matrix), 0010 (the Python channels), 0011 (app config, `mount`, unpublished installs), 0012 (placement and obligations), 0013 (raw body), 0015 (printing, golden tests, suite profiles), 0016 and 0023 (the shared obligations and the placement this one mirrors), 0025 (runtime packaging, version guards), 0027 (the Django targets on this core).
- Proof in the development phase: the review of this ADR, the spike above, and the end-to-end gate on the FastAPI consumer.
