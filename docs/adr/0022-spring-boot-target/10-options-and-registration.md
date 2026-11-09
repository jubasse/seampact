### Options and registration

The target options, validated against the schema the target publishes, with unknown keys refused by name:

- `package`, required;
- the naming options of ADR 0007: `suffixes`, `escape`, `enumCase`, `handlers`;
- `indent` and `layout`;
- `responses` (`strict`, the default, or `warn`);
- `bodyValidation` (`false`, the default, or `true`);
- `frameworkEtag` (`strip`, the default, or `keep`);
- `catchAll` (`true`, the default, or `false`);
- `springSecurity` ("Native security layers").

At run time, the generated configuration binds `seampact.<api>.*` Boot properties:

- `responses` and `body-validation` for the api;
- `operations.<operation-id>.responses` per operation.

An operation's property wins over the api's property, which wins over the target option.

Hooks are beans: authenticate hooks, deciders, scope resolvers and the idempotency store implement the `seampact-hooks` interfaces, narrowed by the generated request records, and `onUnexpectedError` is an optional bean of a functional interface. Each api generates its own `<Api>Decider`, `<Api>ScopeResolver` and `<Api>UnexpectedErrorListener` over the runtime's `Decider`, `ScopeResolver` and `UnexpectedErrorListener`; its boundary looks up only the beans of its own interfaces, so two apis never call each other's deciders or receive each other's failures (ADR 0025), and a bean of a runtime type itself fails the boot check. The generated bean methods take the api's `SeampactBoundary` by its bean name, since every api's boundary has that one class. A decider bean names the rights and rules it serves; two beans claiming one name fail the boot check, and no default hook exists (ADR 0012 "Registration and per-right overrides"). The request context is a request attribute under a generated name (ADR 0012 "Open tenancy"). The handler reads it from its input record: `principal()`, the identity's principal class, null for an anonymous caller on an optional-auth route and absent on a public one, and `scopes()`, a generated `<Operation>Scopes` record with one `ResolvedScope` per scope the operation runs in, absent without scopes; the boundary injects both when it binds the input, never from the request.

The configuration class is picked up by component scan when the `package` option is under the app's own package, or by `@Import(TasksSeampactConfiguration.class)`; registering it twice is deduplicated by Spring. A non-servlet application (WebFlux) fails the start, naming the fix, instead of skipping the boundary silently. Two apis are two configuration classes, each with its own filter, interceptor and boot check.

The registration uses no `@Profile` or `@ConditionalOnProperty` to change behaviour: AOT and native builds fix conditions at build, so they behave as the JVM build does. Run-time settings are the `seampact.<api>.*` properties above.
