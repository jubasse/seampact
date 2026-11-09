### Placement

The developer writes controller services implementing the api's generated interfaces (ADR 0007 `handlers`, `TasksEndpoints`) and marks each method with the generated attribute. Each method takes the operation's generated input:

```php
final class TasksController implements TasksEndpoints
{
    #[SeampactOperation('updateTask')]
    public function updateTask(UpdateTaskInput $input): UpdateTaskResult { ... }
}
```

Codegen emits, per api, under the target entry's `out`, in its PSR-4 namespace:

- **Per operation**: the input class, the result classes, one exception class per code, and the operation's generated constraint (`UpdateTaskInputConstraint`) with its validator.
  The input class also carries who is calling (ADR 0012 "Open tenancy"), from the api's boundary state and outside the validated tree: `principal()` on a route with an identity, the generated `<Identity>Principal` built from the declared members (null for an anonymous caller on an optional-auth route), and `scopes()` on a scoped route, the generated `<Operation>Scopes` with one accessor per scope returning its `ResolvedScope`. Both are private members behind their accessor, so a JSON encoding or a serializer of the input never writes them, and a dump prints them as `[redacted]`.
- **The boundary subscriber** (`TasksBoundary`), one event subscriber with the listeners below. Step 1, the routed marker, the exception record and the outgoing check act on the main request only, so the sub-request through which `ErrorListener` renders an exception, and a fragment's sub-request, are neither matched again nor checked twice:
  - `kernel.request` at priority 512, after `DebugHandlersListener` and before `ValidateRequestListener`, the session, `RouterListener` and the firewall. It runs step 1: the request context, the raw-path match of "Routes" below, the media type, the bounded body read and the decoding. It answers its own refusals in the api's format and stores the match in a request attribute under a generated name. It reads the body only when the raw path matches an operation that takes one. It also counts the main requests its container instance has seen, for the worker guard of "Refused by name or waiting".
  - `kernel.request` at priority 31, right after `RouterListener`, which marks that routing ran.
  - `kernel.controller` at priority 0, which runs steps 2 to 8 (below) and stores the typed input in a request attribute; its fail-closed checks also run on sub-requests ("Types and validation").
  - `kernel.view` at priority 0, which writes the reply of a generated result ("The reply path").
  - `kernel.exception` at priority 2048, which records the first exception of the request, and at priority 128, which renders the generated exceptions, and at priority -64, which answers an exception no role maps ("Exceptions on contract routes").
  - `LoginFailureEvent`, which records an authenticator's exception as the request's exception, since an authenticator's failure reply never reaches `kernel.exception`. SecurityBundle copies a global listener of that event onto every firewall's dispatcher.
  - `kernel.response` at priority -2048, after `SessionListener` (-1000), which runs the outgoing response check and the mapping of framework refusals.
- **The input value resolver** (`TasksInputResolver`), tagged `controller.argument_value_resolver` at priority 150, above `RequestAttributeValueResolver` (100). For a parameter typed with one of the api's input classes, it returns the input the `kernel.controller` listener stored, and nothing else.
- **The route loader** (`TasksRouteLoader`), tagged `routing.loader`, which registers each operation ("Routes").
- **The registration**: one bundle per api (`TasksSeampactBundle`), which the app lists in `config/bundles.php`. Its extension registers the services above, and its compiler passes:
  - find the one service definition implementing each generated interface, tag it `controller.service_arguments` and register the interface id as a public alias, so the routes can name the interface (spike). This pass runs at `TYPE_BEFORE_OPTIMIZATION` with priority 1, before Symfony's own pass that registers controller arguments; an interface with no implementer or several is left as is, for the boot check to refuse;
  - run the container part of the boot check ("The boot check").

  Its `boot()` refuses a declared worker runtime ("Refused by name or waiting").

The routes point at the interface (`TasksEndpoints::updateTask`), which the container resolves to the implementing service (spike). Each route is named `seampact.<api id>.<operationId>`, as the boundary reads it (the routing resource and the bundle configuration keep the snake-case api key, `tasks_service` and `seampact_tasks_service`, and the route check's fix names that resource), and carries the operation id in its defaults, under `_seampact_operation`.

The generated types go into the PSR-4 namespace `composer.json` gives the entry's output directory, which the runner derives (ADR 0010 "Namespaces"), so no option names it; the schema types go into its `Schemas` sub-namespace. The Symfony placement goes into its `Symfony` sub-namespace, with the api's own `SeampactOperation` attribute and `Decider`, `ScopeResolver` and `UnexpectedErrorListener` interfaces, which extend the runtime's so that the boundary, the autoconfiguration and the listener lookup match one api's classes only; no runtime is generated: the code imports it from the installed packages (ADR 0025). A declared schema `UpdateTask` and a placement class never share a namespace. Fixed class names that ADR 0007 has no role for are Pascal-case words prefixed by the api's type name, and constants are upper snake case (`MAX_CHECKED_ERROR_BODY_BYTES`).

The handler method returns the operation's generated result: an interface implemented by one final class per declared success status and by the typed error result (ADR 0007 `errors` role). It may instead throw one of the generated exceptions, declared with `@throws` on the interface method (ADR 0012 "Errors the handler answers"). A decide hook that throws Symfony's `AccessDeniedException` (`denyAccessUnlessGranted()`) answers the requirement's first declared denial code. Any other exception from a hook is a 500 with `onUnexpectedError` called (ADR 0012 "Failures inside hooks").
