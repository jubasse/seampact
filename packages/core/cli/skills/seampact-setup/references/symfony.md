<!-- Generated from docs/backend/symfony.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Symfony

Page: https://jubasse.github.io/seampact/backend/symfony/

## Set up

You need:

- PHP with the extensions `json` and `zlib`, and Symfony 7.4 or 8 (7.3 and older are refused);
- `symfony/validator`, which `seampact/symfony` installs: the boundary checks every input with it;
- php-fpm. A worker runtime (FrankenPHP worker, RoadRunner, Swoole) is refused with `runtime.worker.unsupported`.

Install seampact from Packagist. `seampact/hooks` comes with it.

```sh
composer require seampact/symfony
```

In `seampact.config.yaml`, add one entry per api:

```yaml
outDir: src/Generated
sources:
  contract: { path: contract }
targets:
  - id: tasks
    out: Tasks
    use: seampact/symfony
    api: tasks
```

`out` names the PHP namespace folder under `outDir`. Map `outDir` in `composer.json` (`"App\\": "src/"` covers `src/Generated`).

The skeleton's `config/services.yaml` loads all of `src/`, so it loads `src/Generated` too. That works as is: the bundle registers its own services, and the classes it registers carry `#[Exclude]`. You do not need an `exclude` line.

Generate:

```sh
vendor/bin/seampact generate
```

`bin/console seampact:generate` does the same. To use it, list `Seampact\Symfony\SeampactCommandsBundle` in `config/bundles.php` for `dev` only. It still runs when the generated code comes from another seampact version, which every other command refuses.

Commit the generated files ([Generated files](https://jubasse.github.io/seampact/configuration/config-file/#generated-files)). `seampact check` fails CI when they drift from the contract; [Commands per stack](https://jubasse.github.io/seampact/features/commands-per-stack/) shows how to run it.

## Wire it in

List the api's bundle for every environment, and import its routes:

```php
// config/bundles.php
App\Generated\Tasks\Symfony\TasksSeampactBundle::class => ['all' => true],
```

```yaml
# config/routes/seampact.yaml
seampact_tasks:
    resource: tasks
    type: seampact
```

The resource is the api key, the snake case of the api name (`tasks_service` for `tasksService`). Two apis are two bundles and two imports.

The loader declares one route per operation, with the contract's method and path. Do not set a `prefix`, a `host`, `schemes` or a `condition` on the import: the boot check refuses them. To serve the api under a prefix, set `mount: /api` on the target entry.

Your own routes stay beside the contract's. The boot check refuses one that is not in the contract unless `frameworkRoutes` allow-lists it.

### Route names and URLs

Each route is named `seampact.<api>.<operation>`. Its parameters take the names of the input properties, so the router builds a URL by name:

```php
// $urls is Symfony's UrlGeneratorInterface
$urls->generate('seampact.tasks.getTask', ['taskId' => $task->id]);
```

Each api also gets `TasksRouteNames`, one constant per route name, and `TasksUrls`, one method per operation that builds its path from typed parameters. `TasksUrls` returns the contract's path, encoded as the generated clients encode it:

```php
use App\Generated\Tasks\Symfony\TasksRouteNames;
use App\Generated\Tasks\Symfony\TasksUrls;

$urls->generate(TasksRouteNames::GET_TASK, ['taskId' => $task->id]);
TasksUrls::getTask($task->id); // '/v1/tasks/42'
```

`artefacts: { routeHelpers: false }` leaves both classes out. A parameter name over 32 characters gets a positional name instead (`{p2}` for the second parameter).
