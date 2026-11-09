### DRF

#### Placement

The developer writes a class per resource that implements the api's generated protocol, and a factory that builds it from the request:

```python
class TasksService:
    def __init__(self, request: HttpRequest) -> None:
        self.user = request.user

    def update_task(self, request: UpdateTaskRequest) -> UpdateTaskResult: ...


def tasks_endpoints(request: HttpRequest) -> TasksEndpoints:
    return TasksService(request)
```

```python
urlpatterns = [
    path("", include("app.generated.tasks.urls")),
    path("admin/", admin.site.urls),
]
```

Codegen emits, per api, beside the shared parts:

- **One `APIView` per contract path**, in the api's `drf` module, with one method per operation of the path. Each `path()` entry is named `seampact.<api>.<operationId>` after the path's first operation; `<Api>RouteNames` gives each operation its path's name.
- **One serializer per operation input** ("Types and validation").
- **The exception handler**, which the views return from `get_exception_handler()`.

DRF runs `initial()` first: authentication, permissions and throttles, the app's native layer. The generated method then checks the boundary's mark and the chosen route, runs steps 2 to 5, then steps 6 to 8 on the boundary's decoded tree, and calls the handler with frozen dataclasses.

The views fix what DRF would otherwise read from the app's defaults:

- `perform_content_negotiation()` returns a fixed pair, so `Accept` never answers 406;
- `renderer_classes` holds one class and `default_response_headers` is empty, so DRF adds neither `Allow` nor `Vary: Accept` to the reply (review probe);
- `parser_classes` holds one parser that hands DRF a copy of the body the boundary decoded, and `versioning_class` is `None`. The views never read `request.data`; an app class may, and DRF's CSRF check reads `request.POST`, which would answer 415 without a parser;
- `get_authenticators()`, `get_permissions()` and `get_throttles()` return the classes the app sets for the operation's access kind (`public`, `optional`, `identity`, or `signed` for an identity a signature verifies, as the PHP targets key their native layers) in `settings.SEAMPACT["<api>"]["access"]`, keyed by DRF's own names (`authentication_classes`, `permission_classes`, `throttle_classes`), and none otherwise. The app's `DEFAULT_PERMISSION_CLASSES` never applies to a contract route, so a global `IsAuthenticated` never refuses a public operation;
- `schema = None`, so DRF's schema generator skips them.

DRF 3.18's `as_view()` sets `login_required = False`, so Django's `LoginRequiredMiddleware` never redirects a contract request (review probe). The target relies on it, and a target test fails by name if a DRF minor drops it.

DRF copies the user it authenticated to the Django request, so a hook factory reads `request.user` and `request.auth`. On an access kind with no DRF authentication classes, DRF overwrites `request.user` with its `UNAUTHENTICATED_USER` (review probe), so the user Django's `AuthenticationMiddleware` set is lost. The DRF guide tells the app to name `SessionAuthentication`, or its own class, for that kind.

The view claims an idempotency key after step 6, before the handler runs. The boundary middleware settles the claim with the reply that goes out, so a reply the exception handler or the api's 500 writes settles it too: it completes the record, or abandons it after a server error, an exception that propagates into it, or a streamed reply. Under ASGI it settles and abandons the record through `sync_to_async(thread_sensitive=True)`, in the thread the sync views run in, so a store that uses the ORM works as under WSGI. A stored reply is raised as `ReplayedReplyError`, which the exception handler answers as it was stored.

DRF views are sync. An `async def` hook or handler method is refused by the boot check, naming the method and the fix, until a consumer needs it.

#### Exceptions

`get_exception_handler()` returns the generated handler, never the app's `EXCEPTION_HANDLER` (spike). It marks the transaction for rollback, as DRF's own handler does under `ATOMIC_REQUESTS`. It renders a contract exception, and answers with the role of:

- `NotAuthenticated` and `AuthenticationFailed`: `unauthenticated`, by class. DRF gives them 403 when the first authentication class sends no `WWW-Authenticate` (spike);
- the CSRF failure of `SessionAuthentication` (spike): `csrfInvalid`. `get_authenticators()` wraps `enforce_csrf` of each `SessionAuthentication` it returns, so the failure itself is tagged, not any `PermissionDenied` raised during authentication;
- any other DRF `PermissionDenied`, and Django's: `forbidden`;
- `NotFound` and Django's `Http404`: `notFound`;
- `Throttled`: `rateLimited`, with `Retry-After` from its `wait`;
- any other `APIException`: the role of its status, as ADR 0026 maps an `HTTPException`.

Any other exception is the api's 500, logged, with `onUnexpectedError` called.

#### Types and validation

The handler gets the generated input as frozen slotted dataclasses, with ADR 0026's `Field[T]` for a member both optional and nullable. The serializer validates the boundary's decoded tree after the generated type layer:

- The type layer checks every type first, with ADR 0026's conversions (whole-number floats, date-time, date, UUID, decimal and enum strings). So DRF's lax conversions, such as a `CharField` turning `5` into `"5"`, never see a wrong type.
- String fields set `trim_whitespace=False` and `allow_blank=True`, so DRF never changes a string.
- Fields are built in `get_fields()`, never declared as class attributes. A field declared as `data`, `errors` or `fields` passes at run time, since DRF's metaclass removes it from the class, but `mypy --strict` with the DRF stubs refuses it against the serializer's own attributes (spike).
- A refused input raises the generated `schemaInvalid` exception, so the 400 is rendered. Each issue carries its `{ in, pointer, rule }`, the contract rule kept per DRF error code, bounded by `MAX_RENDERED_ISSUES = 100`.

The target takes `rules` (ADR 0009):

- **`native`, the default.** A value rule becomes DRF's own field argument where DRF has one: `min_length`, `max_length` (both counted in code points, as the contract counts), `min_value`, `max_value`. Exclusive bounds, `multipleOf`, `enum`, `const` and formats stay generated validators. The DRF guide lists the differences in a few lines.
- **`seampact-consistent`.** Every value rule is a generated validator with ADR 0003's meaning.

In both modes a `pattern` is the IR's normalised pattern (ADR 0003 section 9), checked by the framework-free pattern check of `seampact-codegen`'s runtime (py-core-5), never by DRF's `RegexField`. That check runs Python's `re` on the pattern after ADR 0003 section 9's normalisation, so `$` never matches before a final newline and `\d` matches ASCII digits only, as the contract says. The same check serves `rules: seampact-consistent` on every Python target; FastAPI and Ninja keep pydantic-core's engine under `native` (ADR 0026).

#### Native docs

DRF ships no API document of its own that the target switches. Like Laravel and Symfony, it declares no `nativeDocs` artefact: the app config refuses the key by name (`config.artefacts.unknown`). `frameworkDocs: keep` is accepted; `frameworkDocs: off` is refused (`config.frameworkDocs.unsupported`), with the fix to remove the app's own schema view.
