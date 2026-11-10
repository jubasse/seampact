### The boot check

The boot check runs in a `SmartInitializingSingleton`, before the server starts (spike). It first compares the version the api's generated binding carries with the runtime's, as ADR 0025 G3 says, and refuses alone with `runtime.generated-for-other-version`. It then reads `RequestMappingHandlerMapping`, every `HandlerMapping` bean ordered before it (`RouterFunctionMapping` at `-1`, the actuator's at `-100`, the app's own) and the context, lists every problem at once with the operation id, the name and the fix, and throws, so the app does not start:

- the hook problems of ADR 0016's list;
- a contract operation without a bound handler (no mapped method carries its composed annotation), or with two;
- a contract handler that Spring MVC maps at another path than the entry's `mount` followed by its contract path, as under a `PathMatchConfigurer.addPathPrefix` the mount does not state;
- a mapping ordered before `RequestMappingHandlerMapping` that serves a contract method and path, which would take the route from the contract handler; a mapping that cannot list its routes is left to the run-time rule of "A reply the boundary did not author";
- a mapping that no composed annotation registered and that `frameworkRoutes` does not allow-list (FR-25):
  - springdoc's paths read from its own properties (`springdoc.api-docs.path`, `/v3/api-docs` and `/v3/api-docs.yaml` by default, and the UI's paths) are accepted while `frameworkDocs` is `keep` (ADR 0011 "Which OpenAPI documents exist"); under `off` they are a problem whose fix names the generated properties file;
  - Boot's error path (`server.error.path`, `/error`) is accepted as the container's error target; a contract route reaches it only under `warn`, by a `sendError` the boundary let through;
- the boundary filter not ordered before Spring Security's chain, or a `ShallowEtagHeaderFilter`, `FormContentFilter` or `HiddenHttpMethodFilter` ordered before it;
- a servlet container other than Tomcat ("Refused by name or waiting") or a reactive application;
- a Spring Boot major other than 4, read from `SpringBootVersion`; `generate` already refuses 3.x from the build's resolved version.

`artefacts.bootCheck: { frameworkRoutes, hooks }` switches the framework-route check and the hook check apart (ADR 0011); the handler check runs whenever the boot check does. `{ hooks: warn }` waits for an app that needs it: the generator refuses it by name (`artefacts.bootCheck.hooks.warn.unsupported`).

The property `seampact.<api>.unbound-operations` takes `error` (the default, an operation without a handler is a problem) or `warn`, as NestJS's `unboundOperations` (ADR 0016): a `@WebMvcTest` slice that loads some controllers starts, the unbound operations are logged once, and the boundary filter answers their routes with the api's `notFound` reply in its format, or a bare 404 with no body when no route of the api declares one (as Node's servers). `warn` reads the unbound operations even when `artefacts.bootCheck` switches the handler check off, so their routes never reach Spring Security or Spring MVC. Any other value is a boot problem. The hook problems still cover every operation.
