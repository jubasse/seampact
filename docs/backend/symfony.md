# Write the handlers (Symfony)

`seampact/symfony` generates the contract's PHP code. You write the controllers and the hooks; the generated boundary checks each request and each reply.

## Set up

Nothing is published to Packagist yet, so Composer installs seampact from your checkout. Replace `~/src/seampact` with the path of your checkout.

```bash
composer config minimum-stability dev
composer config prefer-stable true
composer config repositories.seampact path "$HOME/src/seampact/php/*"
composer require seampact/symfony
```

The boundary checks every input with `symfony/validator`, which `seampact/symfony` installs.

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

The classes the bundle wires itself (the settings, the hooks and the boundary) are not injected by type in your app: use the services they call.

Generate, then list the api's bundle for every environment and import its routes:

```bash
vendor/bin/seampact generate
```

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

The resource is the api key, the snake case of the api name (`tasks_service` for `tasksService`). Do not set a `prefix` or a `host` on the import. To serve the api under a prefix, set `mount: /api` on the target entry. Two apis are two bundles and two imports.

`bin/console seampact:generate` does the same as the vendor binary. To use it, list `Seampact\Symfony\SeampactCommandsBundle` in `config/bundles.php` for `dev` only. It still runs when the generated code comes from another seampact version, which every other command refuses.

## Routes

The loader declares one route per operation, with the contract's method and path. Import it once per api, as in [Set up](#set-up).

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

`artefacts: { routeHelpers: false }` leaves both classes out.

The boot check refuses a `prefix`, a `host`, `schemes` or a `condition` on the import, and a `#[Route]` on an endpoints method: the loader already declares that route. `generate` refuses a path segment that mixes a parameter with text (`path.segment.mixed.unsupported`), and a static segment with `{`, `}` or `?` (`path.segment.literal.unsupported`). A parameter name over 32 characters gets a positional name instead (`{p2}` for the second parameter).

Your own routes stay beside the contract's. The boot check refuses one that is not in the contract unless `frameworkRoutes` allow-lists it (see [The boot check](#the-boot-check)). By default only routes that reach a path of the api are checked; `artefacts.bootCheck.frameworkRoutes: strict` checks them all.

## Write a controller

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

### Who is calling

On a route with an identity, the input's `principal()` returns the caller in the generated `<Identity>Principal` class. It is `null` for an anonymous caller on an optional-auth route. A public route has no `principal()`.

When the route runs in scopes, the input's `scopes()` has one method per scope. Each returns what your scope resolver returned, with its `id` and its `value`. Load an entity once in the resolver, then read it here:

```php
$workspace = $input->scopes()->workspace()->value;
$userId = $input->principal()->userId;
```

Neither comes from the request body or is validated with it, and each api reads its own. `$this->getUser()` and `#[CurrentUser]` are set only when the firewall authenticates.

Do not put `#[IsGranted]` or `#[IsCsrfTokenValid]` on these methods: the boot check refuses them. Use a decider or an `access_control` rule instead (below). The routes come from the generated loader, not from `#[Route]`.

A version in a body is checked for its format only. Compare it with the stored one and return the operation's conflict error when they differ.

A deadline is a declared header, so read it from the checked input headers. Once the deadline has passed, stop the work and answer the operation's `deadlineExceeded` error. `budgetMs` is the client's timeout; the boundary does not enforce it.

## Register the hooks

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

A decider lists the names it answers in `names()`, or `[self::EVERY_NAME]` for all of them.

Each api has its own interfaces in `App\Generated\<Api>\Symfony`: `Decider`, `ScopeResolver` and `UnexpectedErrorListener`. Implement the ones of the api the hook serves. The listener is told of each 500 the api answers.

## With SecurityBundle

The firewall runs before the contract's access steps. So:

- Your authenticate hook reads the firewall's user from the token storage (`Security::getUser()`, as above).
- Your decider asks your voters with `isGranted`. The subject carries the request params and the scopes. A refusal throws `AccessDeniedException`, and the api answers the operation's first denial code.

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

### Answer rights with your voters

Instead of writing the decider above, register the runtime's `VoterDecider` with your api's deciders tag:

```yaml
# config/services.yaml
services:
    Seampact\Symfony\Runtime\VoterDecider:
        tags: ['seampact.tasks.deciders']
```

It calls `isGranted('<right>', $request)` for every right and rule, and a denial answers the first denial code. Your voter reads the `RequirementRequest` subject: `params()`, `subject()`, `scopes()`, `principal()`. A decider of your own that names a right wins over it.

## Lists, idempotency, throttle

- **Paging.** A paged list gets its page parameters in `$input->query` and a generated `<Operation>Page` class to return.
- **Idempotency.** Alias the api's store id, `seampact.<api key>.idempotency_store`, to a service of yours that implements `Seampact\Hooks\IdempotencyStore`:

```yaml
services:
    seampact.tasks.idempotency_store: '@App\Idempotency\DoctrineIdempotencyStore'
```

  A replayed request gets the saved reply and your handler does not run. A 5xx reply releases the key.
- **Throttle.** Count the bucket in your decider, with a RateLimiter factory (`framework.rate_limiter`), keyed by `$request->bucket()->key`. `bucket()` can be null, so check it first. Return a denial with the `rateLimited` code when the limiter refuses.

## Signed webhooks

A route signed by a provider reads the raw body. Your authenticate hook gets it with `$request->signature()` and verifies it with `seampact/signed-webhooks`. A bad signature is a `Denied` result. See [Signed webhook errors](../troubleshooting/signed-webhooks.md).

## Configuration at run time

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

When the contract writes absolute URLs, set `public_origin` to the origin your clients call, such as `https://api.example.com`: a scheme, a host and an optional port, no path.

## Your data and the contract

The boundary hands you a generated class and sends back one. A Doctrine entity is not that class. Map your entity to the contract type in the controller:

```php
return new GetTaskResponse200(new Task(taskId: $entity->getId(), title: $entity->getTitle()));
```

A field the contract does not declare never leaves the boundary, so an extra column on your entity is not sent.

## Validate your own objects

The generated schema classes carry Symfony Validator attributes, such as `#[Assert\Length(min: 1, max: 200)]` on a title. Validate an object you build before you send it elsewhere:

```php
$violations = $validator->validate(new Task(taskId: $id, title: $title));
```

The boundary does not use these attributes: it checks the raw JSON with the generated constraint. A `uuid` format, a length or pattern on a `date-time` member, and a member both optional and nullable have no attribute.

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

## The boot check

The app refuses to start, and lists every problem, when:

- an identity has no authenticate hook, a right or rule no decider, a scope no resolver, an idempotent operation no store;
- an operation has no handler, or a method lacks `#[SeampactOperation]`;
- a route that is not in the contract is served and not allow-listed;
- an app route sits before a contract route on the same path;
- `framework.http_cache` is on;
- a contract method or controller carries `#[IsGranted]`: the message prints the `access_control` rule to paste instead;
- the contract writes absolute URLs and `public_origin` is missing or is not an origin;
- the contract writes relative URLs and `public_origin` is set, from an `%env()%` value too.

`bin/console cache:warmup` runs it: run it at deploy. Allow-list your own routes in the entry, with a reason:

```yaml
    frameworkRoutes:
      - { path: "/admin/**", reason: "Back office, not part of the api." }
```

Find each message in [Troubleshooting](../troubleshooting/boot.md).

## What is not served yet

`generate` refuses these by name, until an app needs them: multipart and file values, form bodies, download and redirect responses, and `artefacts: { accessHooks: false }`. Remove the operation from the entry's `operations` filter to generate the rest. See [Troubleshooting](../troubleshooting/generate.md).

Serve the app with php-fpm. A worker runtime (FrankenPHP worker, RoadRunner, Swoole) is refused with `runtime.worker.unsupported`.

## Versions

Symfony 7.4 and 8 are tested. The CI runs Symfony 7.4 on PHP 8.3 and 8.5, and Symfony 8 on PHP 8.5. The package accepts PHP 8.3.36, 8.4.27, 8.5.12 and later patches. Symfony 7.3 and older are refused.
