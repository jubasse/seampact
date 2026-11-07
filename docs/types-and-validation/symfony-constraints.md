# Symfony constraints

`seampact/symfony` writes a readonly class for each schema, with Symfony Validator attributes, and a generated constraint for each operation that checks the request. The bundle runs the constraint before your controller.

Used by: [Symfony](../backend/symfony.md).

## Set up

Nothing to add: the `seampact/symfony` target writes the classes. Its one option for validation is `rules`.

```yaml
# seampact.config.yaml, under targets
  - id: tasks
    out: Tasks
    use: seampact/symfony
    api: tasks
```

## What you get

A schema is a readonly class with `#[Assert]` attributes. For the `CreateTask` schema of the [overview](README.md), in `Schemas/CreateTask.php`:

<!-- excerpt: php/symfony/tests/golden/TasksConsistent/Schemas/CreateTask.php -->
```php
  public function __construct(
    #[Assert\NotNull, Assert\Length(min: 1, max: 200), \SensitiveParameter]
    public string $title,
    #[Assert\GreaterThanOrEqual(value: 0)]
    public ?int $effort,
```

A pattern is an `Assert\Regex`, but a `uuid` or `date-time` format has no attribute, so these attributes are not the whole contract.

## Which checks run on a request

The request is not checked by these attributes. For each operation, `Symfony/<Operation>InputConstraintValidator.php` lists the members of the input as the contract declares them, and the bundle checks the decoded request against that list. This excerpt is from `rules: seampact-consistent`:

<!-- excerpt: php/symfony/tests/golden/TasksConsistent/Symfony/CreateTaskInputConstraintValidator.php -->
```php
          'title' => new Member(
            JsonType::String,
            checks: new Checks(minLength: 1, maxLength: 200),
          ),
          'effort' => new Member(
            JsonType::Integer,
            presence: Presence::Optional,
            checks: new Checks(minimum: 0),
          ),
```

The attributes are for your own code. Validate an object you build before you send it elsewhere:

```php
$violations = $validator->validate(new Task(taskId: $id, title: $title));
```

## When a check fails

Each failure becomes an issue of the [400 body](README.md#when-a-check-fails), named by the contract rule.

## Native or consistent rules

`native` (the default) uses Symfony Validator's own constraints where one exists. `seampact-consistent` gives the contract's exact checks, equal on every target ([Switch the validator](../configuration/validators.md#native-or-consistent-rules)).

## Limits

The Symfony generator refuses by name a `oneOf`, a map schema, a file value and a property `default` ([Generate fails](../troubleshooting/generate.md#php)).

## Next

- [Symfony](../backend/symfony.md).
- The 400 body: [When a check fails](README.md#when-a-check-fails).
