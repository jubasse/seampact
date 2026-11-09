### Options and registration

The target options, validated against the schema the target publishes, with unknown keys refused by name:

- `handlers`, `perResource` only: `perOperation`, one interface per operation for an `__invoke` controller, waits for an app that needs it (`options.handlers.unsupported`);
- `indent`;
- `rules` (`native`, the default, or `seampact-consistent`);
- `responses` (`strict`, the default, or `warn`);
- `bodyValidation` (`false`, the default, or `true`);
- `frameworkEtag` (`strip`, the default, or `keep`);
- `catchAll` (`true`, the default, or `false`).

The naming options of ADR 0007 (`suffixes`, `escape`, `enumCase`) are refused by name (`options.naming.unsupported`): the target names PHP with the ADR 0007 defaults, which the shared naming vectors test. `layout` is refused too (`options.layout.unsupported`): one file per class under the PSR-4 directory is the only layout Composer loads. `namespace` is no option: the runner derives it from PSR-4, and the key is refused as unknown. These options are the same on every PHP target, read by `seampact/codegen`.

At run time, the generated code reads the bundle's configuration, under the extension alias `seampact_<api>`:

```yaml
# config/packages/seampact_tasks.yaml
seampact_tasks:
    responses: '%env(default:seampact.tasks.responses:SEAMPACT_TASKS_RESPONSES)%'
    body_validation: false
    operations:
        updateTask: { responses: warn }
    public_origin: '%env(SEAMPACT_TASKS_PUBLIC_ORIGIN)%'
```

- `responses` and `body_validation` for the api;
- `operations.<operationId>.responses` per operation; an operation id the api does not declare fails the container build, naming it and the declared ids;
- `public_origin`.

An operation's value wins over the api's value, which wins over the target option. Every value may be an `%env()%` placeholder. The bundle's `Configuration` declares scalar nodes, never enum or typed nodes that would reject a placeholder, and `load()` passes the values unchanged as arguments of the generated settings service. `load()` first refuses a literal value outside its values with an `InvalidConfigurationException` naming the key and the accepted values, so a typo such as `responses: stric` fails the container build; it tells an `%env()%` value by resolving its placeholder, and leaves it to the settings service. That service checks every value when the boundary first reads it, on each kernel boot: an invalid value answers the api's 500 on every contract route and logs the key and the accepted values, never the value. A value changed in the environment applies without a cache clear (spike).

The bundle registers its services under `seampact.<api id>.<role>` ids (`route_loader`, `input_resolver`, `settings`, `hooks`, `boundary`, `hook_check_warmer`, `route_check`), named by constants of the bundle class, never under class names, and the classes it registers carry `#[Exclude]`. The skeleton's `services.yaml` loads every class of `src/`, the generated tree included: a class-named definition it writes, autowired or excluded, would replace the bundle's when the container merges the extension configuration, and `#[Exclude]` keeps it from autowiring a class whose arguments are the bundle's. The app needs no `exclude` line.

Hooks are tagged services: authenticate hooks, deciders, scope resolvers and the idempotency store implement the `seampact/hooks` interfaces, narrowed by the generated request classes, and the extension tags them through autoconfiguration (`seampact.tasks.authenticate` and the like). `onUnexpectedError` is an optional service of the api's generated `Symfony\UnexpectedErrorListener` interface, so two apis never receive each other's failures. A decider names the rights and rules it serves; two claiming one name fail the boot check, no default hook exists, and a missing hook answers 500 (ADR 0012 "Registration and per-right overrides"). The request context, the resolved scopes included, is a request attribute under a generated name (ADR 0012 "Open tenancy").

Two apis are two bundles, each with its own subscriber, resolver, loader, configuration and boot check.
