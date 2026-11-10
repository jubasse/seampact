### Options and registration

The target options, validated against the schema the target publishes, with unknown keys refused by name:

- `handlers`, `perResource` only (`options.handlers.unsupported` for `perOperation`, until an app needs it);
- `indent` (four spaces by default, as `ruff format` writes);
- `rules` (`native`, the default, or `seampact-consistent`);
- `responses` (`strict`, the default, or `warn`);
- `bodyValidation` (`false`, the default, or `true`);
- `frameworkEtag` (`strip`, the default, or `keep`);
- `catchAll` (`true`, the default, or `false`).

The naming options of ADR 0007 are refused by name (`options.naming.unsupported`), and so is `layout` (`options.layout.unsupported`): one package per api is the only layout.

At run time, `bind_<api>()` takes keyword arguments: `responses`, `body_validation`, `operations` (per operation, `responses`), and `public_origin`. An operation's value wins over the api's, which wins over the target option. The app passes values from its own settings (pydantic-settings, environment, files); the runtime reads no environment variable itself.

Hooks are factories that are FastAPI dependencies, passed to `bind_<api>()` keyed by the contract's names: `authenticate` per identity, `deciders` per right or rule, `scope_resolvers` per scope, `idempotency_store`, and `on_unexpected_error`. FastAPI resolves them per request as dependencies of the access dependency, so a hook can take `Depends(get_db)` and shares the request's cached session with the handler. An operation's access dependency depends only on the hooks it needs. A missing hook fails the boot check; at run time it answers 500 (ADR 0012 "Registration and per-right overrides"). The request context, the resolved scopes included, lives in the request scope.

Two apis are two `bind_<api>()` calls, each with its own router, boundary and boot check.
