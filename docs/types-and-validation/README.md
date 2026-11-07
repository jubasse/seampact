# Types and validation

Use these pages to see what each stack gets from the schemas of your contract: the types you code against and the validators that refuse a bad request before your handler runs. They all show the same schema, `CreateTask`, trimmed here to what the examples need.

```yaml
# contract/api.yaml, under schemas
CreateTask:
  type: object
  required: [title]
  properties:
    title: { type: string, minLength: 1, maxLength: 200 }
    effort: { type: integer, minimum: 0 }
```

Each schema becomes one type and one validator per direction: input (what a client sends) and output (what your handler returns). Each operation also gets one input validator over its path, query, headers and body. An input validator refuses a key the contract does not declare.

## What your stack gets

| Stack | Types | Validator | You pick the validator? |
|---|---|---|---|
| NestJS | [TypeScript types](typescript-types.md) | [zod](zod.md) (default), [yup](yup.md) or [class-validator](class-validator.md) | Yes, with the `validators` entry |
| Express, Hono | [TypeScript types](typescript-types.md) | [zod](zod.md) or [yup](yup.md) | Yes, with the `validators` entry |
| Fastify | [TypeScript types](typescript-types.md) | [zod](zod.md) or [yup](yup.md), or [Ajv](ajv.md) when you link none | Yes |
| AdonisJS | [TypeScript types](typescript-types.md) | [zod](zod.md) or [yup](yup.md), or [VineJS](vinejs.md) when you link none | Yes |
| Spring Boot | [Java records](java-records.md) | Bean Validation, plus a generated check for strings | No |
| Laravel | PHP classes | [Laravel rules](laravel-rules.md) | `rules` only |
| Symfony | PHP classes | [Symfony constraints](symfony-constraints.md) | `rules` only |
| FastAPI, Django Ninja | [Pydantic](pydantic.md) models | Pydantic | `rules` only |
| Django REST Framework | dataclasses | [DRF serializers](drf-serializers.md) | `rules` only |

Server guides: [NestJS](../backend/nestjs.md), [Express](../backend/express.md), [Fastify](../backend/fastify.md), [AdonisJS](../backend/adonisjs.md), [Hono](../backend/hono.md), [Spring Boot](../backend/spring-boot.md), [Laravel](../backend/laravel.md), [Symfony](../backend/symfony.md), [FastAPI](../backend/fastapi.md), [Django REST Framework](../backend/drf.md), [Django Ninja](../backend/ninja.md).

Client guides use the [TypeScript types](typescript-types.md) through the [fetch client](../frontend/fetch-client.md). The generators that write zod, yup and class-validator validators serve the server only.

To change the library on a Node server, see [Switch the validator](../configuration/validators.md).

## Native or consistent rules

By default (`rules: native`) the generated validator uses the library's own rules, such as `.min()`, `uuid` or `Field(max_length=...)`. The library behaves as you know it, and in a few places it differs from the contract: how it counts the length of an emoji, or what it accepts as a date. Each library page lists them.

Set `rules: seampact-consistent` to get the contract's exact checks instead. Every client, server and language then gives the same answer.

```yaml
# seampact.config.yaml, under targets
  - id: validators
    use: "@seampact/codegen-yup"
    apis: [notes]
    options:
      rules: seampact-consistent
```

The option exists on the zod, yup, class-validator, AdonisJS, Laravel, Symfony, FastAPI, Django REST Framework and Django Ninja targets. Spring Boot has no such option: its Java page says what is checked. The error body is the same in both modes.

## When a check fails

A request the validator refuses never reaches your handler. The server answers `400` with the error `api.schema_invalid`, as `application/problem+json`.

```json
{
  "type": "api.schema_invalid",
  "status": 400,
  "code": "api.schema_invalid",
  "nature": "refused",
  "issues": [
    { "in": "body", "pointer": "/title", "rule": "minLength" },
    { "in": "body", "pointer": "/effort", "rule": "minimum" }
  ]
}
```

Each issue has three members.

- `in`: where the value sits: `path`, `query`, `header` or `body`.
- `pointer`: the value inside that part, as a JSON pointer. A pointer of `""` is the whole body.
- `rule`: the contract rule that failed, such as `required`, `type`, `minLength`, `maxLength`, `minimum`, `format`, `enum` or `unknownKeys`. It is never the library's own error code, so a client reads the same rule from every server.

The reply lists every issue, up to 100. An unknown key gives one issue per key. The message text a library writes is its own and never travels in the body.

A contract can rename the code or reshape `issues` with a `derived` binding ([Errors and natures](../grammar/11-errors-and-natures.md)). The members above are the defaults.

## Next

- Your stack: pick its page in the table above.
- Change the library: [Switch the validator](../configuration/validators.md).
