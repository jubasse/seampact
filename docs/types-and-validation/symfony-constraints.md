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

## Add your own rules

The contract checks the shape of the input. A rule that needs your data, such as "the end comes after the start", is yours to write, as Symfony constraints. It runs after the contract's checks and the idempotency claim, and before your handler.

Write a rule class that names its operation and part, and returns its constraints. Implement your api's generated `<Api>InputRules` interface (`App\Generated\<Api>\Symfony\<Api>InputRules`); with autoconfiguration on, that is all the wiring. The boot check refuses a service tagged for the api that does not implement it:

<!-- excerpt: scripts/consumers/targets/symfony/src/Suite/Rules/ScheduleTaskBodyRules.php -->
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

    /** @return array<Constraint> */
    public function constraints(): array
    {
        return [new EndAfterStart(), self::windowTooLong(), self::unnamedNoteRule()];
    }
}
```

- `part()` is `path`, `query`, `headers` or `body`. Write one class for each operation and part.
- The constraints run on the part's typed object, the one your handler gets, so a member is named as in your code (`end`, `items[0].name`). A constraint on the object itself, such as a `Callback` or a class constraint, checks members against each other.
- A part the request does not carry, such as an optional body that was not sent, is not checked.
- A rule can only refuse. It cannot change what the handler gets.

A custom constraint is written once and reused on any operation:

<!-- excerpt: scripts/consumers/targets/symfony/src/Suite/Rules/EndAfterStartValidator.php -->
```php
final class EndAfterStartValidator extends ConstraintValidator
{
    public function validate(mixed $value, Constraint $constraint): void
    {
        if ($value instanceof ScheduleTask && $value->end <= $value->start) {
            $this->context->buildViolation('The end must come after the start.')->atPath('end')->addViolation();
        }
    }
}
```

A refusal answers the operation's `schemaInvalid` role, like the contract's own issues, with every issue of every rule together. The pointer is the wire name of the member the violation points at, with array indices kept. A path the contract cannot map points at the nearest member it can.

The rule gets its name, with the prefix `app.`, from the first of these:

1. The constraint's payload: `new Callback(..., payload: Rule::payload('windowTooLong'))` gives `app.windowTooLong`.
2. The code the violation sets with `setCode()`.
3. The short class name of a custom constraint, first letter lowered: `EndAfterStart` gives `app.endAfterStart`.

A built-in constraint such as `NotBlank`, an anonymous class and a name that is not letters, digits, `_`, `.` or `-` (64 at most) answer `app.invalid`, and the log says once how to name the rule. The message of a rule never reaches the client; the name is the key a client translates.

- A rule that throws answers the api's 500, and the log names the operation, the part and the rule class.
- A refusal releases the idempotency key, so a corrected retry with the same key is checked again. A retry of a request that succeeded replays its reply and meets no rule.
- API Platform apis do not take input rules yet: the api gets no `<Api>InputRules` interface, and a service tagged `seampact.<api>.input_rules` stops the boot with `input.rules.unsupported`.

Keep three things out of a rule:

- A uniqueness check stays in the handler, as a declared 409.
- A rule that reads your data on a sign-up route can let a caller find which accounts exist. Throttle the route or answer the same way.
- The caller: a rule is not given the principal. A rule about the caller is a decider or the handler.

A rule you write also lives only on the server. When a client needs the same pure check, write it in the client too. `diff` cannot see a rule that narrows the accepted input; when the contract's grammar can say it, say it there.

## Limits

The Symfony generator refuses by name a `oneOf`, a map schema, a file value and a property `default` ([Generate fails](../troubleshooting/generate.md#php)).

## Next

- [Symfony](../backend/symfony.md).
- The 400 body: [When a check fails](README.md#when-a-check-fails).
