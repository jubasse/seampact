# API Platform

`seampact/api-platform` generates the contract's PHP code for API Platform 5 on Symfony. API Platform routes the operations and keeps its docs and security glue. The generated boundary checks each request, as on Symfony.

This target is being delivered in steps. Today the boundary serves API Platform routes and answers its refusals (unknown path, missing credentials, invalid input). Handler results are not written yet: those replies, the Hydra look and the validation body arrive in the next releases.

API Platform 5 on Symfony 7.4 and 8, PHP 8.3, 8.4 or 8.5. API Platform 4 is not supported.

## Set up

```sh
composer require seampact/api-platform api-platform/symfony
```

In `seampact.config.yaml`, use the target for each api:

```yaml
targets:
  - id: tasks
    out: Tasks
    use: seampact/api-platform
    api: tasks
```

Generate with `vendor/bin/seampact generate`.

## What is generated

You get everything the [Symfony target](symfony.md) generates, plus, per api:

- one `#[ApiResource]` class per resource, with one API Platform operation per contract operation;
- one processor per operation, which calls your handler.

Write handlers as on Symfony: a service that implements the generated `<Resource>Endpoints` interface, each method marked with `#[SeampactOperation]`.

## Wire it in

List the api's bundle in `config/bundles.php`, and let API Platform read the generated resources:

```yaml
# config/packages/api_platform.yaml
api_platform:
    mapping:
        paths: ['%kernel.project_dir%/src/Generated']
```

```yaml
# config/routes/api_platform.yaml
api_platform:
    resource: .
    type: api_platform
```

Do not import the Symfony route loader: API Platform registers the contract routes.

## What the boundary keeps

Each contract operation turns off API Platform's own `read`, content negotiation, `deserialize` and `validate`. The boundary reads and checks the request, so the contract alone decides an input. The boot check refuses an app that changes these switches, sets `securityPostDenormalize` or `securityPostValidation` on a contract operation, or replaces its processor.

API Platform's `security` expression still runs, after the boundary and before your handler. Its `object` is `null`.

App input rules are not available on this target yet.
