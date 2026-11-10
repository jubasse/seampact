<!-- Generated from docs/backend/api-platform.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# API Platform

Page: https://jubasse.github.io/seampact/backend/api-platform/

## Write a handler

Write handlers as on [Symfony](https://jubasse.github.io/seampact/backend/symfony/#write-a-handler): a service that implements the generated `<Resource>Endpoints` interface, each method marked with `#[SeampactOperation]`. Return one arm of the result.

```php
final class TasksController implements TasksEndpoints
{
    #[SeampactOperation('getTask')]
    public function getTask(GetTaskInput $input): GetTaskResult
    {
        $task = $this->tasks->find($input->path->taskId);

        return $task === null
            ? GetTaskErrors::apiNotFound()
            : new GetTaskResponse200($task);
    }
}
```

Do not put `#[ApiResource]`, `#[Route]` or `#[IsGranted]` on these methods, and do not write a processor or a provider. The generated ones run.

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
