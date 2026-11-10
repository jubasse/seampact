### Placement

The developer writes a class per resource that implements the api's generated protocol (ADR 0007 `handlers: perResource`, `TasksEndpoints`), and a factory that builds it. The factory is a FastAPI dependency, so it takes the app's own dependencies:

```python
class TasksService:
    def __init__(self, db: Session) -> None:
        self.db = db

    async def update_task(self, request: UpdateTaskRequest) -> UpdateTaskResult: ...


def tasks_endpoints(db: Session = Depends(get_db)) -> TasksEndpoints:
    return TasksService(db)


app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=settings.origins)
bind_tasks(app, handlers=TasksHandlerFactories(tasks=tasks_endpoints), authenticate={"bearer": bearer_hook})
```

Each method takes the operation's generated request (`UpdateTaskRequest`). It holds:

- `input`, the typed input: the path, query and header parameters and the body; the credential and CSRF headers stay the boundary's;
- who is calling (ADR 0012 "Open tenancy"), read from the boundary's request state, never from the wire: `principal` on a route with an identity, the generated `<Identity>Principal` (`None` for an anonymous caller on an optional-auth route), and `scopes` on a scoped route, one attribute per scope holding its `ResolvedScope`.

Its `repr` prints `principal` and `scopes` as `[redacted]`.

Codegen emits, per api, a package under the target entry's `out`:

- **Per operation**: the request, the input model and its parts, the result classes and one exception class per code. `bind_<api>()` hands the runtime each operation's request, success and errors classes (`OperationTypes`) with one `add_operation` call per route.
- **The boundary middleware** (`TasksBoundary`), a pure ASGI middleware. It runs step 1: the request context, the raw-path match of "Routes", the media type, the bounded body read and the decoding. It runs the outgoing response check, the boot check on `lifespan.startup`, and the first-request fallback. It answers its own refusals in the api's format.
- **The access dependency**, in each contract route's `dependencies`. It runs steps 2 to 5: authenticate, principal requirements, scopes and requirements. It first checks that the route FastAPI's router chose (`scope["route"]`) carries the operation the raw path matched. Once steps 2 to 5 admit the request, it marks the request scope with the operation id. Its hook factories are its sub-dependencies, so they run before that check and before step 2: they are the app's native layer, and a refusal one raises (a `Security` scheme's 401 or 403) answers as "Exceptions on contract routes" says.
- **The input dependency**, an endpoint parameter that takes the access dependency as a sub-dependency (FastAPI resolves that once per request). It runs steps 6 to 8 on the boundary's decoded tree, builds the typed input and marks the request scope with it. Without the access mark for its own operation, it fails closed: the api's 500 and `onUnexpectedError`, before any input is read.
- **The endpoint**, one per operation. It takes only the `Request`, the input dependency and the handler factory, in that order, so the input is checked before the factory opens a session. Without the input mark for its own operation, it fails closed as the input dependency does. It calls the handler method and writes its result.
- **`bind_tasks(target, ...)`**, the one call the app makes, last, after its own middleware and exception handlers. `target` is the app, or an `APIRouter` of the app's choosing. It builds the api's `APIRouter` with the app's factories as dependencies and includes it into `target` with no prefix, registers the exception handlers, wraps the app's `HTTPException` handler ("Exceptions on contract routes"), and adds the boundary with `add_middleware`, so it is the outermost of `app.user_middleware`.

`bind_<api>()` builds the router itself, rather than leaving `include_router` to the app: FastAPI fixes a route's dependency tree when the route is added, and the factories are known only when the app calls `bind_<api>()`. An override in `app.dependency_overrides` would also be lost to an app test's `dependency_overrides.clear()`. The routes stay the framework's: generated code declares them, and the app chooses the router tree they join. When `target` is an `APIRouter`, the app also passes itself (`app=`), since the boundary and the exception handlers belong to the app, and calls `bind_<api>()` before it includes that router. FastAPI 0.162 does not copy an included router's routes: `include_router` keeps a reference, and a route added later is served too. The order is still the rule, so the boot check finds the routes where "The boot check" looks for them.

The schema types go into the package's `schemas` module, the operation types into its `operations` module (on every Python target, since the generator cannot know the import path of the package's root), the contract the runtime reads into its `contract` module, which every Python target writes alike, and the FastAPI placement into its `fastapi` module. A declared schema and a placement class never share a module; a name taken twice in a module is refused as `name.collision`. No runtime is generated: the code imports it from the installed distributions (ADR 0025).

The handler returns the operation's generated result: a union of one frozen class per declared success status and the typed error result (ADR 0007 `errors` role). It may instead raise one of the generated exceptions. Any other exception from a hook is a 500 with `onUnexpectedError` called (ADR 0012 "Failures inside hooks").
