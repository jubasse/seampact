# API Platform

`seampact/api-platform` generates the contract's PHP code for API Platform 5 on Symfony. API Platform routes the operations and keeps its docs and security glue. The generated boundary checks each request, as on Symfony.

seampact writes the wire, not API Platform: the boundary checks each request and writes every reply, from your handler's result or a declared error. API Platform's serializer never writes a body. For the API Platform look, see [The API Platform pack](#the-api-platform-pack).

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
- one processor per operation, which calls your handler;
- one reply decorator, which writes the contract reply from your handler's result, so API Platform's serializer never writes a body.

## Write a handler

Write handlers as on [Symfony](symfony.md#write-a-handler): a service that implements the generated `<Resource>Endpoints` interface, each method marked with `#[SeampactOperation]`. Return one arm of the result.

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

## What the boundary keeps

Each contract operation turns off API Platform's own `read`, content negotiation, `deserialize` and `validate`. The boundary reads and checks the request, so the contract alone decides an input. The boot check refuses an app that changes these switches, sets `securityPostDenormalize` or `securityPostValidation` on a contract operation, or replaces its processor.

## Security

The contract's access rules run in the boundary, as on Symfony: identities, rights, rules and scopes through your hooks. See [Symfony security](symfony.md#use-securitybundle).

API Platform's `security` expression still runs, after the boundary and before your handler.

```php
#[ApiResource(operations: [new Get(security: "is_granted('ROLE_ADMIN')")])]
```

- Its `object` is `null`: the body is not denormalized.
- An `AccessDeniedException` it throws answers the api's `forbidden` (or `unauthenticated`) in the api's format.
- `securityPostDenormalize` and `securityPostValidation` on a contract operation are refused at boot.

## The API Platform pack

Add the pack to the contract:

```yaml
# top of contract/api.yaml
packs: ["@seampact/pack-api-platform"]
```

It sets the API Platform wire for the api:

- items and collection members carry `@id`, `@type` and `@context`;
- a nested item's `@id` is built from its member route;
- collections are Hydra pages (`member`, `totalItems`, `view`);
- a failed validation answers 422 with a `violations` list (`propertyPath`, `message`).

`propertyPath` is the JSON pointer of the field, not a PHP property path. An operation whose format writes `$itemSelf`, or `$self` on an item, needs a member route (a get by id under the same parent), or `generate` refuses it with `format.self.member-route`.

## Refusals

| Code | When | Fix |
|---|---|---|
| `input.rules.unsupported` | A service is tagged `seampact.<api>.input_rules`: `cache:warmup` stops. The api gets no `<Api>InputRules` interface. | Untag it, or serve the api on [Symfony](symfony.md). Input rules arrive in 1.1.x. |
| `format.self.member-route` | `generate`: the format writes a member URL and the resource has no member route. | Declare the member route, or write the format without the slot. |
| `paging.handlerResult.unsupported` | `generate`: a paging fact (`complete`, the changes feed) is not generated yet. | Remove the operation from `operations`. |
| the operation sets `<switch>` | Boot: the app changed `read`, `write`, content negotiation, `deserialize` or `validate`, replaced a processor, or set a provider on a contract operation. | Remove the change. |

The boot messages are in [Boot errors](../troubleshooting/boot.md#api-platform), the generate codes in [Generate errors](../troubleshooting/generate.md).
