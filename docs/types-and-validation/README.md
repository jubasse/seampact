# Types and validation

Draft. The contract's schemas are the single source of types and checks. Each target turns them into the types and validators of its own stack.

| Stack | Generator | What it writes |
|---|---|---|
| TypeScript | `@seampact/codegen-ts` | One `interface` per object schema, one union of literals per enum, one input, output and error type per operation. |
| Node, zod | `@seampact/codegen-zod` | `schemas/input.ts`, `schemas/output.ts`, `operations/input.ts` and `wire-checks.ts`: zod schemas. |
| Node, yup | `@seampact/codegen-yup` | The same layout with yup schemas. |
| NestJS, class-validator | `@seampact/codegen-class-validator` | Decorated DTO classes in `dtos/`, wrapped as Standard Schema values. |
| AdonisJS, VineJS | `@seampact/codegen-adonis` | A VineJS validator built from a plan literal, no separate target. |
| Spring Boot | the Gradle or Maven plugin | Java records with Bean Validation annotations. |
| Laravel, Symfony | `seampact/laravel`, `seampact/symfony` | Readonly classes, a `FormRequest` with rules (Laravel), `#[Assert]` attributes (Symfony). |
| FastAPI, Ninja, DRF | the Python wheels | Pydantic models (FastAPI, Ninja), dataclasses and serializers (DRF). |

Next: [Switch the validator](../configuration/validators.md).
