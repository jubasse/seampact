<!-- Generated from docs/backend/api-platform.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# API Platform

Page: https://jubasse.github.io/seampact/backend/api-platform/

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
