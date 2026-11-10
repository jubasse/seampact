### Ninja

This section can be cut alone.

#### Placement

The developer writes the same resource class and factory as on DRF, and calls one function in the module that builds its `NinjaAPI`:

```python
api = NinjaAPI()
bind_tasks(api, prefix="/v1", handlers=TasksHandlerFactories(tasks=tasks_endpoints), authenticate={"bearer": bearer_hook})

urlpatterns = [path("", api.urls)]
```

`bind_tasks(api, ...)` builds the api's `Router` and adds it to the app's `NinjaAPI` with `add_router()`. The prefix where the app includes `api.urls`, plus `prefix`, must equal `mount`; the boot check's resolver match refuses any other sum. `bind_<api>()` also takes ADR 0026's keyword arguments (`responses`, `body_validation`, `operations`, `public_origin`), and per access kind the `auth` and `throttle` values Ninja accepts on an operation. For an access kind the app gave no values, `bind_<api>()` passes `auth=None` and `throttle=[]`, so a `NinjaAPI(auth=...)` set app-wide never refuses a public operation (review probe: 401 otherwise).

Each operation is one `api_operation()` call:

- with `["GET", "HEAD"]` for a `GET` operation, since a Ninja `GET` operation answers `HEAD` with 405 (spike);
- with `include_in_schema=False`;
- with a view that takes the request and one `str` parameter per path placeholder, which Ninja cannot refuse, so it answers no 422 (spike). The view ignores them: the input comes from the boundary's raw decoding. A view without them would make Ninja warn at URLconf import for each placeholder, and fail under `python -W error` (review probe).

Each contract path also declares `OPTIONS`, without `auth=` or throttles, with a view of the same parameters that answers the path's `notFound` 404: the boundary leaves a CORS preflight to the app, and when no CORS layer answers it, Ninja would answer 405, as DRF's `options` would answer its metadata.

`bind_<api>()` marks the Django views of the contract paths `login_required = False`, so Django's `LoginRequiredMiddleware` never redirects a contract request; it would answer a bearer caller without a session with a 302 (review probe). A target test fails by name if the mark stops reaching Ninja's views.

`bind_<api>()` takes Ninja's per-access-kind values as `access`, a mapping from each access kind to `AccessSettings(auth=..., throttle=...)`: the `auth=` and `throttle=` Ninja applies to that kind's operations, none when the kind is absent.

Ninja runs `auth=` and throttles first. The generated view then checks the boundary's mark and the chosen route, runs steps 2 to 5, then validates the decoded tree with the shared Pydantic models of ADR 0026 "Types and validation" (strict mode, the same type layer, the same `rules`).

The target option `views` is `sync`, the default, or `async`. Async views run natively under ASGI and through Django's adapter under WSGI (spike). In sync views an `async def` hook or handler method is refused by the boot check, as on DRF. In async views a `def` method runs through Django's `sync_to_async`.

#### Exceptions

The generated view answers the api's own exceptions itself (a contract refusal, a raised contract exception, a replayed idempotent reply, a failure of the boundary), so no handler the app adds to its `NinjaAPI` takes them. `bind_<api>()` wraps the app's `NinjaAPI.on_exception`, which Ninja calls for every exception it handles, `auth=` failures included (spike). The wrapper records the exception, then calls the app's. `on_exception` is not in Ninja's guide, so a test of the target fails by name if a minor stops calling it, and the boot check refuses an `on_exception` replaced after `bind_<api>()`.

On a contract route the boundary answers with the role of:

- `AuthenticationError`: `unauthenticated`;
- `AuthorizationError`: `forbidden`;
- `Throttled`: `rateLimited`, keeping `Retry-After`;
- `Http404`: `notFound`, which Ninja renders itself without calling `handler404` (spike);
- any other `HttpError`: the role of its status.

Ninja re-raises any other exception to Django outside `DEBUG` (spike), and Django would log its message on `django.request`. On a request a boundary matched, outside `DEBUG` and `DEBUG_PROPAGATE_EXCEPTIONS`, the wrapper answers such an exception with a bare 500 instead, which the boundary replaces with the api's 500, logging the class and the place only, as on DRF. A `BadRequest` or `SuspiciousOperation` still goes to Django.

#### The boot check

Beside the shared list, the check reads the values `bind_<api>()` took: a `responses` mode other than `strict` or `warn`, an `operations` value that is not an `OperationSettings`, and a `body_validation` that is not a bool are refused by name. So are an `auth=` or a throttle on an access kind with an operation that declares no reply for its refusal (`unauthenticated` or a single 401 code, `rateLimited` or a single 429 code), since Ninja's refusal would become the api's 500. A second `bind_<api>()` on the same `NinjaAPI` raises. Ninja's own docs routes, read from the `NinjaAPI`'s `docs_url` and `openapi_url` under its prefix, are framework routes, accepted and listed in the report (ADR 0011).

#### Native docs

Contract operations are always registered with `include_in_schema=False`, so Ninja builds no schema of its own for them. With the `nativeDocs` artefact, `bind_<api>()` wraps `NinjaAPI.get_openapi_schema()` so each document it builds holds the api's operations with seampact's operation objects at their paths under the entry's `mount`, and seampact's components beside the app's; a component the app's document holds with another value fails the boot, naming it. The generated `native_docs.json` and its reader are the ones FastAPI uses (ADR 0026 "Native docs"). `frameworkDocs: keep` is accepted; `frameworkDocs: off` is refused (`config.frameworkDocs.unsupported`), with the fix `NinjaAPI(docs_url=None, openapi_url=None)`.
