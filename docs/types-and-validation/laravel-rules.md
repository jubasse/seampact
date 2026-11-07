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

## Limits

The Laravel generator refuses by name a `oneOf`, a map schema, a file value and a property `default` ([Generate fails](../troubleshooting/generate.md#php)).

## Next

- [Laravel](../backend/laravel.md).
- The 400 body: [When a check fails](README.md#when-a-check-fails).
