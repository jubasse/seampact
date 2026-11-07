# VineJS

The AdonisJS target writes its own VineJS validators from your contract when you link none. AdonisJS validates with VineJS already, and the server names each issue by the contract rule.

Used by: [AdonisJS](../backend/adonisjs.md) only, when its entry has no `validators` link.

## Set up

Nothing to add: the AdonisJS starter depends on `@vinejs/vine`, and the `@seampact/codegen-adonis` target writes the validators in its own `validators/` folder. There is no separate validators target.

To use [zod](zod.md) or [yup](yup.md) instead, add a `validators` entry and link it ([Switch the validator](../configuration/validators.md)).

## What you get

The files have the same layout as the [zod](zod.md) ones: `schemas/input.ts`, `schemas/output.ts`, `operations/input.ts` and `wire-checks.ts`, plus a `vine-support.ts`.

A generated schema is not a chain of `vine.object()` calls. It is a plan: a plain object that lists each field, its type and its checks (a rule name, its limit and its message). `vine-support.ts` reads the plan and builds the VineJS validator. So you read the contract to know what is checked, and you do not edit the plan.

For `CreateTask`, the plan says:

- `title` is a required string with a minimum length of 1 and a maximum length of 200.
- `effort` is an optional integer with a minimum of 0.
- Any other key is refused.

An operation validator checks `path`, `query`, `headers` and `body` together.

## When a check fails

Each VineJS error becomes one issue of the [400 body](README.md#when-a-check-fails), named by the contract rule.

## Native or consistent rules

`@seampact/codegen-adonis` takes the `rules` option (`native` by default). With `native`, the validators use VineJS's own rules, which differ from the contract in a few places.

- Lengths count UTF-16 units: an emoji counts 2, so `maxLength: 1` refuses "😀".
- `uuid` also checks the version and variant digits. `00000000-0000-9000-8000-000000000000` is refused.
- `date-time`, `exclusiveMinimum`, `exclusiveMaximum` and `multipleOf` have no VineJS rule: they stay the contract's checks.
- Under the native rules, an issue's message may be VineJS's own text; the rule name is the same in both modes.

Set `rules: seampact-consistent` on the server entry for the contract's exact checks ([AdonisJS options](../backend/adonisjs.md#options)).

## Limits

The generator refuses by name a `oneOf`, a property `default`, a `nullable` value other than an opaque one and the other forms in [Generate fails](../troubleshooting/generate.md#node-servers).

## Next

- [AdonisJS](../backend/adonisjs.md).
- The 400 body: [When a check fails](README.md#when-a-check-fails).
