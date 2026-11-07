# class-validator

`@seampact/codegen-class-validator` writes a decorated DTO class for each schema of your contract, input and output, and NestJS uses the input ones to refuse a bad request before your handler runs.

Used by: [NestJS](../backend/nestjs.md) only.

## Set up

Install `class-validator` and `class-transformer` in your app, and set `experimentalDecorators` in `tsconfig.json` as the [NestJS page](../backend/nestjs.md) asks. Then point the `validators` entry at this package.

```yaml
# seampact.config.yaml, under targets
  - id: validators
    use: "@seampact/codegen-class-validator"
    apis: [notes]
```

Link it from your server entry, next to `types`:

```yaml
    link:
      types: types
      validators: validators
```

Run `npx seampact generate`. The classes land in `dtos/` under the `validators/<api>/` folder of your `outDir`.

## What you get

For the `CreateTask` schema of the [overview](README.md), trimmed from `dtos/input.ts`:

<!-- excerpt: packages/targets/codegen-class-validator/rules-snapshots/native/dtos/input.ts.snap -->
```ts
export class CreateTaskDto {
  @IsString()
  @MinLength(1, { message: "Expected at least 1 character." })
  @MaxLength(200, { message: "Expected at most 200 characters." })
  title!: string;

  @contract.ValidateIfPresent()
  @IsInt()
  @contract.SafeInteger()
  @Min(0)
  effort?: number;
}
```

Each DTO is wrapped in a `schemas/` value your server reads, so every validator library looks the same to the server:

<!-- excerpt: packages/targets/codegen-class-validator/rules-snapshots/native/schemas/input.ts.snap -->
```ts
export const CreateTaskSchema = adapter.dtoSchema(
  inputDtos.CreateTaskDto,
  "input",
);
```

The helpers named `contract.` come from `constraints.ts` in the same folder. They carry the checks class-validator has no decorator for.

## When a check fails

The server converts the plain value to the DTO without coercion and reads each violation. Each one becomes an issue of the [400 body](README.md#when-a-check-fails), named by the contract rule the violation carries, never by the decorator.

## Native or consistent rules

With the default `rules: native`, the DTOs use class-validator's own decorators, which differ from the contract in a few places.

- Lengths skip the variation selectors U+FE0E and U+FE0F: "❤️" counts 1.
- `uuid` also checks the version and variant digits.
- `date-time` does not check the calendar, and accepts second 60, a space instead of `T` and more than 9 fraction digits.
- `exclusiveMinimum` and `exclusiveMaximum` have no class-validator rule: they stay the contract's checks. So do the checks on each item of a list, which report the item's position.

Set `rules: seampact-consistent` for the contract's exact checks ([Switch the validator](../configuration/validators.md#native-or-consistent-rules)).

## Limits

The generator refuses by name a `oneOf`, a property `default`, a `nullable` value other than an opaque one and the other forms in [Generate fails](../troubleshooting/generate.md#node-servers). It works on NestJS only.

## Next

- [Switch the validator](../configuration/validators.md).
- The NestJS setup: [NestJS](../backend/nestjs.md).
