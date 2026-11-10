# Symfony

`seampact/symfony` generates the contract's PHP code for Symfony. You write the controllers and the hooks; the generated boundary checks each request and each reply.

Symfony 7.4 and 8 on PHP 8.3, 8.4 or 8.5. See [Supported versions](../supported-versions.md).

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

The request is checked by generated [Symfony constraints](../types-and-validation/symfony-constraints.md); see [Types and validation](../types-and-validation/README.md).

`out` names the PHP namespace folder under `outDir`. Map `outDir` in `composer.json` (`"App\\": "src/"` covers `src/Generated`).

The skeleton's `config/services.yaml` loads all of `src/`, so it loads `src/Generated` too. That works as is: the bundle registers its own services, and the classes it registers carry `#[Exclude]`. You do not need an `exclude` line.

Generate:

```sh
vendor/bin/seampact generate
```

`bin/console seampact:generate` does the same. To use it, list `Seampact\Symfony\SeampactCommandsBundle` in `config/bundles.php` for `dev` only. It still runs when the generated code comes from another seampact version, which every other command refuses.

Commit the generated files ([Generated files](../configuration/config-file.md#generated-files)). `seampact check` fails CI when they drift from the contract; [Commands per stack](../features/commands-per-stack.md) shows how to run it.

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

Do not put `#[IsGranted]` or `#[IsCsrfTokenValid]` on these methods, or `#[Route]`: the boot check refuses them. Use a decider or an `access_control` rule instead (see [Use SecurityBundle](#use-securitybundle)). The routes come from the generated loader.

A version in a body is checked for its format only. Compare it with the stored one and return the operation's conflict error when they differ. A write versioned with `header.If-Match` answers 428 when the header is missing or empty, before the handler runs. A weak tag (`W/"7"`) is accepted, and the handler receives the version unquoted (`7`). A stale version is a 412: the handler returns the `preconditionFailed` error. See [Catch lost updates](../contract/07-advanced.md#catch-lost-updates).

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

## Write the hooks

Hooks are services. With autoconfiguration on, implementing the generated interface is enough. Write one hook per identity, one decider for your rights and rules, and one resolver per scope.

```php
final class UserHook implements UserAuthenticateHook
{
    public function __construct(private readonly Security $security)
    {
    }

    public function authenticate(AuthenticateRequest $request): AuthenticateResult
    {
        $user = $this->security->getUser();

        return $user === null
            ? new AuthenticateResult\Denied(new Denial('api.unauthenticated'))
            : new AuthenticateResult\Authenticated(new UserPrincipal($user->getUserIdentifier()));
    }
}
```

Each api has its own interfaces in `App\Generated\<Api>\Symfony`: `Decider`, `ScopeResolver` and `UnexpectedErrorListener`. Implement the ones of the api the hook serves.

- A decider lists the names it answers in `names()`, or `[self::EVERY_NAME]` for all of them.
- The listener is told of each 500 the api answers.
- The `params` of a right or rule in a decider request are an instance of the generated class, not an array.
- **Idempotency.** Alias the api's store id, `seampact.<api key>.idempotency_store`, to a service of yours that implements `Seampact\Hooks\IdempotencyStore`. A replayed request gets the saved reply and your handler does not run. A 5xx reply releases the key.

```yaml
services:
    seampact.tasks.idempotency_store: '@App\Idempotency\DoctrineIdempotencyStore'
```

- **Throttle.** Count the bucket in your decider, with a RateLimiter factory (`framework.rate_limiter`), keyed by `$request->bucket()->key`. `bucket()` can be null, so check it first. Return a denial with the `rateLimited` code when the limiter refuses.

### Use SecurityBundle

The firewall runs before the contract's access steps. So:

- Your authenticate hook reads the firewall's user from the token storage (`Security::getUser()`, as above).
- Your decider asks your voters with `isGranted`. The subject, here a class of yours (`DecisionSubject`), carries the request params and the scopes. A refusal throws `AccessDeniedException`, and the api answers the operation's first denial code.

```php
if (!$this->authorization->isGranted($request->name(), new DecisionSubject($request->params(), $request->scopes()))) {
    throw new AccessDeniedException();
}
```

- `login_throttling`, an `AccessDeniedException` and an `HttpException` 401, 403 or 429 thrown by a handler or a listener are answered in the api's error format: `unauthenticated`, `forbidden` and `rateLimited`. When the `rateLimited` code requires `retryAfterMs`, seampact fills it from the exception's or the reply's `Retry-After` (seconds or an HTTP date); without a usable one, the reply is a logged 500 (with an optional `retryAfterMs`, the code is answered without it). Off a contract route, nothing changes.

For `access_control`, the api registers one request matcher per access kind: `seampact.<api>.matcher.public`, `.optional`, `.identity` and `.signed`. Each follows the routes the api serves, so a public `/tasks/search` never covers a protected `/tasks/{id}`.

```yaml
# config/packages/security.yaml
security:
    access_control:
        - { request_matcher: seampact.tasks.matcher.identity, roles: ROLE_USER }
```

The generated `TasksAccess` class lists, per route, the kind, the identity, and the rights and rules it requires.

#### Answer rights with your voters

Instead of writing the decider above, register the runtime's `VoterDecider` with your api's deciders tag:

```yaml
# config/services.yaml
services:
    Seampact\Symfony\Runtime\VoterDecider:
        tags: ['seampact.tasks.deciders']
```

It calls `isGranted('<right>', $request)` for every right and rule, and a denial answers the first denial code. Your voter reads the `RequirementRequest` subject: `params()`, `subject()`, `scopes()`, `principal()`. A decider of your own that names a right wins over it.

## Add your own rules

Your own rules, such as "the end comes after the start", are written as Symfony constraints: see [Add your own rules](../types-and-validation/symfony-constraints.md#add-your-own-rules).

A rule can only refuse. The part it reads is readonly, so a rule that writes to it throws, and the client gets a 500.

## Options

Set under `options:` on the target entry.

| Option | Default | What it does |
|---|---|---|
| `indent` | `4` | Spaces per indent in the generated code, from 1 to 8. |
| `rules` | `native` | `native` uses Symfony Validator's own constraints. `seampact-consistent` gives the contract's exact checks, equal on every target. See [Symfony constraints](../types-and-validation/symfony-constraints.md#native-or-consistent-rules). |
| `responses` | `strict` | `strict` answers 500 when your reply breaks the contract. `warn` logs it and sends the reply. |
| `bodyValidation` | `false` | Checks success bodies against the contract. |
| `frameworkEtag` | `strip` | Drops an ETag or a 304 that the boundary did not write. `keep` leaves them. |
| `catchAll` | `true` | Unknown paths under the api's base path answer the contract's 404. |

Also on the entry: [`mount`](../configuration/reference.md#mount) (a path prefix), [`frameworkRoutes`](../configuration/reference.md#framework-routes) (see [The boot check](#the-boot-check)), `allowUntested`, and under `artefacts`: `routeHelpers` and [`bootCheck`](../configuration/reference.md#boot-check). Settings set on a group flow down to the routes below it: see [Settings flow down the tree](../contract/01-basics.md#settings-flow-down-the-tree). The full list is in the [configuration reference](../configuration/reference.md#symfony).

### Change a setting without generating again

The bundle reads its settings from `seampact_<api>`. Every value may be an `%env()%` placeholder.

```yaml
# config/packages/seampact_tasks.yaml
seampact_tasks:
    responses: strict        # or warn
    body_validation: false
    operations:
        updateTask: { responses: warn }
    public_origin: '%env(TASKS_PUBLIC_ORIGIN)%'
```

An operation's value wins over the api's. A bad written value, such as `responses: stric`, stops `cache:clear` and names the key. A bad `%env()%` value is only seen at run time: it answers the api's 500 on every contract route and logs the key, never the value.

## Paging

A paged list gets its page parameters in `$input->query` and a generated `<Operation>Page` class to return.

## Signed webhooks

A route signed by a provider reads the raw body. Your authenticate hook gets it with `$request->signature()` and verifies it with `seampact/signed-webhooks`. A bad signature is a `Denied` result. See [Signed webhook errors](../troubleshooting/signed-webhooks.md).

## Validate your own objects

The generated schema classes carry Symfony Validator attributes, so you can validate an object you build with `$validator->validate()`. The boundary does not use them: see [Symfony constraints](../types-and-validation/symfony-constraints.md).

## Test your routes

A functional test goes through the boundary like a real request. Send the credential the contract requires, and replace your hook in the test container:

```php
$client = static::createClient();
static::getContainer()->set(UserHook::class, new FakeUserHook('alice'));

$client->jsonRequest('GET', '/v1/tasks/t-1', server: ['HTTP_AUTHORIZATION' => 'Bearer test-token']);

self::assertResponseIsSuccessful();
```

- `loginUser($user)` alone answers 401: the boundary asks for the contract's credential before your hook runs. Send the header too.
- The client reboots the kernel between requests, which drops a replaced service: set it again before each request. `disableReboot()` is refused, as a worker runtime is.
- Replace a decider, a scope resolver or a store the same way.
- A request with a body works as usual: `$client->jsonRequest('POST', '/v1/tasks', [...])` reaches the handler with that body, checked like a real request.

To call a handler directly in a unit test, build its input yourself: it is a plain class. The caller and the scopes come after the wire parts:

```php
$result = $controller->getTask(new GetTaskInput(
    new GetTaskPath('t-1'),
    new UserPrincipal('alice'),
    new GetTaskScopes(new ResolvedScope('channel', 'c-1', $channel)),
));
```

`ResolvedScope` is `Seampact\Hooks\ResolvedScope`. A sub-request from `forward()` skips the boundary, so the handler never runs for it.

### Debug locally

With `kernel.debug` on (the `dev` and `test` environments by default), an exception that no contract error maps shows Symfony's exception page, as on any route. The boundary's log line also names its message and `file:line`. Without debug, the client gets the api's 500, and the log names only the exception class.

A reply that breaks the contract is still a 500 in debug. To see it while you work, let it through in `dev` only:

```yaml
# config/packages/seampact_tasks.yaml
when@dev:
    seampact_tasks:
        responses: warn
```

The profiler records the reply before the boundary checks it. When the boundary replaced it with a 500, the profiler still shows your handler's reply: read the log line for the reason.

## Deploy

- Serve the app with php-fpm.
- Run `APP_ENV=prod bin/console cache:warmup` at deploy, with the production environment variables set. It runs the boot check.
- To serve the api under a prefix, set `mount: /api` on the target entry. Do not set a `prefix` on the route import.
- When the contract writes absolute URLs, set `public_origin` to the origin your clients call, such as `https://api.example.com`: a scheme, a host and an optional port, no path. The request's `Host` is never read.
- Behind a proxy, set Symfony's `framework.trusted_proxies`. It changes Symfony's URL helpers, never the contract's URLs.

In Docker, take a php-fpm image and put the web server (nginx) in front. The generated code is committed, so the image needs no seampact tool. Pass `APP_SECRET`, `TASKS_PUBLIC_ORIGIN` and your other settings as environment variables, never baked into the image.

```dockerfile
FROM composer:2 AS vendor
WORKDIR /app
COPY . .
RUN composer install --no-dev --optimize-autoloader --no-scripts --ignore-platform-reqs

FROM php:8.5-fpm
WORKDIR /var/www/html
COPY --from=vendor /app .
ENV APP_ENV=prod
```

### The boot check

The app refuses to start, and lists every problem. `bin/console cache:warmup` runs it. Find each message in [Boot errors](../troubleshooting/boot.md#symfony).

| Fault | Fix |
|---|---|
| An identity has no authenticate hook, a right or rule no decider, a scope no resolver. | Add the service. |
| An idempotent operation has no store. | Alias `seampact.<api key>.idempotency_store` to your store. |
| Input rules name an operation the api lacks, a part with no input, a relay operation, or two rule sets claim one part. | Fix the rule class, or remove it; tag only classes implementing the api's `<Api>InputRules`. |
| An operation has no handler, or a method lacks `#[SeampactOperation]`. | Implement the endpoints interface and mark each method. |
| A route that is not in the contract is served and not allow-listed. | Add it to `frameworkRoutes` on the entry, or remove it. |
| An app route sits before a contract route on the same path. | Move your route after, or change its path. |
| `framework.http_cache` is on. | Turn it off. |
| A contract method or controller carries `#[IsGranted]`. | For a plain `ROLE_*` or `IS_AUTHENTICATED_*` check, paste the `access_control` rule the message prints. With a subject, `methods`, `statusCode` or `exceptionCode`, use `VoterDecider`. |
| The contract writes absolute URLs and `public_origin` is missing or is not an origin. | Set `public_origin`. |
| The contract writes relative URLs and `public_origin` is set, from an `%env()%` value too. | Unset it. |

Allow-list your own routes in the entry, with a reason. By default only routes that reach a path of the api are checked; `artefacts.bootCheck.frameworkRoutes: strict` checks them all.

```yaml
    frameworkRoutes:
      - { path: "/admin/**", reason: "Back office, not part of the api." }
```

## Limits

- `generate` refuses some forms by name, until an app needs them. The list is in [Generate errors](../troubleshooting/generate.md#php); forms refused on every server are under [every server](../troubleshooting/generate.md#every-server).
- A sort key restricted by a right is refused (`paging.sortKey.right.unsupported`). Leave the key out of `sortable`.
- A query list is read in the default `repeat` form (`tag=a&tag=b`) or as `comma`.

## Next

- [Call the api from React](../frontend/react.md)
- [Call it with the fetch client](../frontend/fetch-client.md)
- [Serve the api on API Platform](api-platform.md)
- [Check the generated code in CI](../features/check-in-ci.md)
