# Laravel rules

`seampact/laravel` writes a `FormRequest` for each operation, with Laravel validation rules built from your contract, and a readonly class for each schema. Laravel runs them before your controller.

Used by: [Laravel](../backend/laravel.md).

## Set up

Nothing to add: the `seampact/laravel` target writes the classes. Its one option for validation is `rules`.

```yaml
# seampact.config.yaml, under targets
  - id: notes
    out: Notes
    use: seampact/laravel
    api: notes
    options: { rules: seampact-consistent }
```

## What you get

A schema is a readonly class: `Schemas/CreateTask.php` has `public string $title` and `public ?int $effort`. A date-time is a `DateTimeImmutable` and an enum is a backed PHP enum.

Each operation has a `<Operation>Request extends FormRequest` whose `contractRules()` lists the rules of each input. For `CreateTask` (with `seampact-consistent`), the rules of the body:

<!-- excerpt: php/laravel/tests/golden/TasksConsistent/CreateTaskRequest.php -->
```php
            'body.title' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::STRING, Presence::Required, Nullability::NotNull),
                new StringRule($input, Position::Member, BlankStrings::Every, minLength: 1, maxLength: 200),
            ],
            'body.effort' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::INTEGER, Presence::Optional, Nullability::NotNull),
                new NumberRule($input, Position::Member, minimum: 0),
            ],
```

A `TypeRule` checks the type and the presence, a `StringRule` the length, a `NumberRule` the bounds, and an `UnknownKeysRule` refuses a key the contract does not declare. Your controller gets the checked input as a typed `<Operation>Input` with `contractInput()`.

## When a check fails

The request's `failedValidation` hands the Laravel validator to the seampact runtime, which turns each failure into an issue of the [400 body](README.md#when-a-check-fails). Under the native rules, a Laravel rule such as `uuid` or `max:200` still reports the contract rule it checks (`format`, `maxItems`), through the request's `NATIVE_RULE_NAMES` table.

## Native or consistent rules

With the default `rules: native`, a check that Laravel has a rule for uses that rule, next to the seampact rule objects. Here is the `ids` list of a batch operation in `GetTasksBatchRequest`:

<!-- excerpt: php/laravel/tests/golden/Tasks/GetTasksBatchRequest.php -->
```php
            'body.ids' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::ARRAY, Presence::Required, Nullability::NotNull),
                'max:200',
            ],
```

`'max:200'` is Laravel's own rule. With `rules: seampact-consistent`, only the seampact rule objects remain, and the answer is the same on every target ([Switch the validator](../configuration/validators.md#native-or-consistent-rules)).

## Add your own rules

The contract checks the shape of the input. A rule that needs your data, such as "the end comes after the start", is yours to write, in Laravel's own validation syntax. It runs after the contract's checks and the idempotency claim, and before your handler.

Write a rule class that names its operation and part, and lists its rules. Implement your api's generated `<Api>InputRules` interface (`App\Generated\<Api>\Laravel\<Api>InputRules`). The boot check refuses a tagged class that does not implement it:

<!-- excerpt: scripts/consumers/targets/laravel/app/Suite/Rules/ScheduleTaskBodyRules.php -->
```php
final class ScheduleTaskBodyRules implements InputRulesInputRules
{
    public function operationId(): string
    {
        return 'scheduleTask';
    }

    public function part(): string
    {
        return 'body';
    }

    public function rules(): array
    {
        return [
            'end' => [new EndAfterStart()],
            '' => [new WindowTooLong(), self::unnamedNoteRule()],
        ];
    }
}
```

Tag the class, beside your deciders (`NotesSeampactServiceProvider` is your api's generated provider):

```php
$this->app->tag([ScheduleTaskBodyRules::class], NotesSeampactServiceProvider::INPUT_RULES_TAG);
```

- `part()` is `path`, `query`, `headers` or `body`. Write one class for each operation and part.
- The keys of `rules()` are wire names inside the part (`end`, `items.*.name`). A header key is lower case. The key `''` is the part itself, for a rule across members. Such a rule is a `ValidationRule` and a `DataAwareRule` with `public bool $implicit = true`, since no member carries it.
- A rule sees the part as your handler gets it: the typed input written back by wire name, so a field the caller may not write is already gone.
- A rule can only refuse. It cannot change what the handler gets.

A rule is written once and reused on any member or operation, as in Laravel:

<!-- excerpt: scripts/consumers/targets/laravel/app/Suite/Rules/EndAfterStart.php -->
```php
final class EndAfterStart implements ValidationRule, DataAwareRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $start = $this->data['start'] ?? null;
        if (is_string($value) && is_string($start) && $value <= $start) {
            $fail('The end must come after the start.');
        }
    }
}
```

A refusal answers the operation's `schemaInvalid` role, like the contract's own issues, with every issue of every rule together. The rule is named after its class, first letter lowered, and carries the prefix `app.`: `EndAfterStart` gives `app.endAfterStart`, Laravel's `after:start` gives `app.after`. The name never collides with a contract rule such as `minLength`.

- The pointer stays where Laravel reports the failure: the member the rule is written on, even when its message names another member.
- A message added with `errors()->add()` has no rule to name: it answers `app.invalid` at that member.
- A closure, an anonymous class and a name that is not letters, digits, `_`, `.` or `-` (64 at most) answer `app.invalid`, and the log says once how to name the rule.
- The message of a rule never reaches the client; the name is the key a client translates.
- A rule that throws answers the api's 500, and the log names the operation and the part.
- A refusal releases the idempotency key, so a corrected retry with the same key is checked again. A retry of a request that succeeded replays its reply and meets no rule.

Keep three things out of a rule:

- A uniqueness check stays in the handler, as a declared 409.
- A rule that reads your data on a sign-up route can let a caller find which accounts exist. Throttle the route or answer the same way.
- The caller: a rule is not given the principal. A rule about the caller is a decider or the handler.

A rule you write also lives only on the server. When a client needs the same pure check, write it in the client too. `diff` cannot see a rule that narrows the accepted input; when the contract's grammar can say it, say it there.

## Limits

The Laravel generator refuses by name a `oneOf`, a map schema, a file value and a property `default` ([Generate fails](../troubleshooting/generate.md#php)).

## Next

- [Laravel](../backend/laravel.md).
- The 400 body: [When a check fails](README.md#when-a-check-fails).
