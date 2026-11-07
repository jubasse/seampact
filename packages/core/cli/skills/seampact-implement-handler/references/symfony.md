<!-- Generated from docs/backend/symfony.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Symfony

Page: https://jubasse.github.io/seampact/backend/symfony/

## Write a handler

Each resource has a generated `<Resource>Endpoints` interface. Implement it as a service, and mark each method with `#[SeampactOperation]`. Return one arm of the operation's result: a `Response200` class and the like, or an error from `<Operation>Errors`.

```php
use App\Generated\Tasks\GetTaskErrors;
use App\Generated\Tasks\GetTaskInput;
use App\Generated\Tasks\GetTaskResponse200;
use App\Generated\Tasks\GetTaskResult;
use App\Generated\Tasks\Symfony\SeampactOperation;
use App\Generated\Tasks\TasksEndpoints;

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

The boundary has already checked the path, query, headers and body. You never write a status or a content type yourself.

Do not put `#[IsGranted]` or `#[IsCsrfTokenValid]` on these methods, or `#[Route]`: the boot check refuses them. Use a decider or an `access_control` rule instead (see [Use SecurityBundle](https://jubasse.github.io/seampact/backend/symfony/#use-securitybundle)). The routes come from the generated loader.

A version in a body is checked for its format only. Compare it with the stored one and return the operation's conflict error when they differ. A write versioned with `header.If-Match` answers 428 when the header is missing or empty, before the handler runs. A weak tag (`W/"7"`) is accepted, and the handler receives the version unquoted (`7`). A stale version is a 412: the handler returns the `preconditionFailed` error. See [Catch lost updates](https://jubasse.github.io/seampact/contract/07-advanced/#catch-lost-updates).

A deadline is a declared header, so read it from the checked input headers. Once the deadline has passed, stop the work and answer the operation's `deadlineExceeded` error. `budgetMs` is the client's timeout; the boundary does not enforce it.

### Who is calling

On a route with an identity, the input's `principal()` returns the caller in the generated `<Identity>Principal` class. It is `null` for an anonymous caller on an optional-auth route. A public route has no `principal()`.

When the route runs in scopes, the input's `scopes()` has one method per scope. Each returns what your scope resolver returned, with its `id` and its `value`. Load an entity once in the resolver, then read it here:

```php
$workspace = $input->scopes()->workspace()->value;
$userId = $input->principal()->userId;
```

Neither comes from the request body or is validated with it, and each api reads its own. `$this->getUser()` and `#[CurrentUser]` are set only when the firewall authenticates.

### With Doctrine

The boundary hands you a generated class and sends back one. A Doctrine entity is not that class. Map your entity to the contract type in the controller:

```php
return new GetTaskResponse200(new Task(taskId: $entity->getId(), title: $entity->getTitle()));
```

A field the contract does not declare never leaves the boundary, so an extra column on your entity is not sent.

## Paging

A paged list gets its page parameters in `$input->query` and a generated `<Operation>Page` class to return.
