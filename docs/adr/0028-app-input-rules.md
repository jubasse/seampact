# ADR 0028: App input rules

Status: accepted, delivered on the Node and PHP servers by #425, #428, #433, #435; Python, Spring Boot and API Platform in 1.2.0

## Context

The generated boundary checks everything the contract can say before the handler runs, and answers the operation's `schemaInvalid` role (400 by default) with `issues: [{in, pointer, rule}]` ([Types and validation](../types-and-validation/README.md)). Apps also have rules the contract cannot say: "the end comes after the start", a stricter format, a check that reads the app's data.

[A45](../decisions.md#a45) decided that such rules are written in the app's code, with each framework's own mechanism, on top of the generated validation, and that the generated boundary accepts them. No target delivers that last part today:

- the Node route table pins each operation's validator export (`packages/core/codegen-core/src/node-server/route-table.ts`);
- the Laravel `<Operation>Request` and the Symfony `<Operation>InputConstraint` are `final`;
- the Python `bind_<api>()` and `settings.SEAMPACT` take no validator;
- the Spring interceptor validates with the generated validator only.

So an app writes these rules in the handler and builds the error by hand. Every target lets it return the typed `schemaInvalid` error, but nothing places the rules, names them or keeps them consistent.

Three cases, three tools:

| Case | Tool |
|---|---|
| A rule on the input: "end after start", a stricter format, a rule that reads app data | This ADR |
| A conflict the client reacts to: "this email is already used" | A declared code (409) returned by the handler ([ADR 0012](0012-access-hooks.md), "Errors the handler answers"). A check before the write races, so the unique constraint and its 409 stay in the handler. |
| A rule on the caller: "this project belongs to the caller" | An access rule: a decider (403) or an `owner` binding with the `notFound` role (404), ADR 0012. Answering 400 would give the wrong status and reveal the record. |

Two spikes and a check of each library's documentation ground this design:

- **The first spike** probed the Spring binding result on records, Laravel `failed()`, Symfony `validate($value, $constraints)`, class-validator subclasses, Ajv keywords, zod 4 `params`, VineJS `report()` and each runtime's idempotency claim.
- **The second spike** compared options per family and probed:
  - yup's error channel;
  - copying values;
  - class-validator with Nest's container;
  - the Node registration types (checked with `tsc`);
  - Pydantic and DRF errors;
  - Spring beans, and where step 8b plugs into each runtime.
- **The library check** confirmed that each row follows the documented way to write a custom rule in that library.

## Decision

### 1. Placement: step 8b

[ADR 0012](0012-access-hooks.md) "The check order" gains a step between 8 and 9. Every runtime takes the idempotency claim just before the handler, after the input checks; the rules run after it:

1. Steps 1 to 8, unchanged.
2. The idempotency replay or claim, unchanged.
3. **8b. App input rules.**
4. Step 9, the handler.

Why there:

- A rule sees only input that passed the contract (step 6), the restricted fields (7) and the bindings (8). It needs no defensive code for a malformed value.
- An unauthenticated or unauthorised caller never reaches a rule. It learns nothing from it and costs no data read.
- A retry of a request that succeeded replays its stored reply. It never meets a rule that reads app data and would now refuse the client's own earlier write.

**A rule's refusal releases the claim.** Every runtime stores a 4xx for replay today. Before it answers, step 8b releases the claim **and clears the request's claimed key**, so the reply's settle stores nothing and a corrected retry with the same key is checked again:

| Runtime | Call | Where it plugs |
|---|---|---|
| PHP | `IdempotencyStep::abandon` (clears the key) | the Laravel and Symfony handler call |
| Spring | `IdempotencyStep.abandon` (no-op without a claim; `settle` then stores nothing) | `BoundaryInterceptor.preHandle`, right after `IdempotencyStep.begin` |
| FastAPI | `abandon_idempotency` on the claim, then `state.idempotency = None`, as the boundary's `_abandon_claim` does | `featured_input`, right after the claim |
| Ninja, Django REST Framework | Django's `abandon_claim` (clears `state.held_claim`) | after `claim_idempotency`: Ninja's `_served` and `_served_async`, DRF's admission |
| Node | a new runtime helper that calls `store.abandon` and clears `context.idempotencyKey` | `runInputSteps` in `handler-map.ts` (Express, Fastify, Hono); its own call in `adonis.ts` and `nestjs.ts` |

The `IdempotencyStore.abandon` contract names the rule refusal beside a server error and a `no-store` error reply.

### 2. Written in the configured library only

The app writes its rules in the validator library its target is configured with, and in nothing else: no seampact rule language, no seampact helper, no second library. This holds under `rules: native` and `rules: seampact-consistent` alike, since both generate code in that library.

**Registration.** Rules are registered per operation and per input part (`path`, `query`, `headers`, `body`). Spring is the exception: one bean per operation over the operation's input record, and a field path's first segment gives the part (§4).

**The value a rule sees.** A rule gets the part **as the handler receives it**: after steps 7 and 8, with the served limit and the sent version applied, and without the body proof fields steps 4 and 5 read. This matters because the generated body schemas are strict: a proof field left in the value would make a rule built on the generated schema refuse every request.

The runtime gives the rule a copy made the library's way:

| Library | Copy |
|---|---|
| zod, yup, VineJS, Ajv | `structuredClone` of the part, which is plain JSON data |
| class-validator | the app's class instantiated from the part's plain form (`plainToInstance`). A structured clone would drop the prototype and skip every rule, silently. |
| Laravel | the handler's typed part turned back into a wire-keyed array through the generated member names, so step 7's strip and the served limit are in; PHP arrays copy by value; keys are relative to the part |
| Symfony | the input's typed part object (`$input->body`, `$input->path`, and so on), which is readonly |
| Pydantic | `model_dump(exclude_unset=True)` in Python mode, validated as the app's model in strict mode: an absent member stays absent (a dumped `None` would be refused by the generated models); JSON mode fails strict dates |
| DRF | the part's validated data, as a dict keyed by the serializer's field names |
| Spring | the input record, which is immutable |

The copy costs about 22 ms per MB with `structuredClone` and twice that with `plainToInstance` (measured, linear, on the event loop); the contract's body limits bound it, and the guide says so.

A rule can only refuse:

- its return value is never used, and the handler keeps its own value;
- a rule cannot weaken or change the handler's input (a widened subclass or `z.any()` is harmless);
- a rule that mutates its copy changes nothing.

**Pointers.** A library that reports wire keys gives the pointer directly: zod, yup, VineJS, Ajv, class-validator on Node (whose properties are wire names, since Node refuses `property.codeName`) and Laravel. Symfony property paths, Pydantic `loc`, DRF error keys and Spring field paths name code members, in camelCase or snake_case per [ADR 0007](0007-cross-language-naming.md); the runtime maps them to the wire pointer and keeps array indices. Python has the nested tables today (DRF maps through `part_members`); PHP builds a reverse walker over its per-schema and per-part tables; Spring builds its map from the generated member names. A segment the runtime cannot map points at the nearest mapped parent.

**Part schemas.** Where the target generates a part's schema, the app extends it: for path, query and headers, zod's `<Op>InputSchema.shape.<part>`, class-validator's `<Op>RequestPathDto`, `<Op>RequestQueryDto` and `<Op>RequestHeadersDto`, the Pydantic `<Op>Path`, `<Op>Query` and `<Op>Headers`; for a body, its named schema's export, DTO or model. Never the operation's own body member (zod's `shape.body`, class-validator's `<Op>RequestBodyDto`): it holds the proof fields, so a rule built on it refuses every request. Elsewhere (an inline body, and the parts a target does not generate), the app writes the part's schema in its library over the keys of the value its family sees (the copy table): wire keys for zod, yup, VineJS, Ajv and Laravel (header keys lowercased), code names ([ADR 0007](0007-cross-language-naming.md)) for Symfony, Pydantic, DRF and Spring. VineJS's generated schemas are opaque values that cannot be extended, so a Vine app always writes its part's schema itself. Issues still use `in: header`.

**Bodies and operations without rules.** Multipart, form and binary bodies are refused at generation on every target, so no rule applies to them. A relay operation takes no rules in this version: the public operation in the gateway runs its own (§6).

### 3. The answer

- **The role:** a refusal answers the operation's `schemaInvalid` role. It is 400 with `issues` by default; `errorRoles` or `conventions.errors.derived` can make it 422 or another shape ([Errors and natures](../grammar/11-errors-and-natures.md)). A rule answers no other code in this version; a refusal the client must tell apart is a declared code from the handler.
- **Same rendering as the contract's issues:** app issues go through the same role and template. A member the template does not carry (the golden `derived` template writes `pointer` and `rule`, not `in`) does not reach the wire, and a format pack places them where it places the contract's (PHP JSON:API under `meta.issues`).
- **Several issues:** all the issues of all the rules of all the parts are answered together, capped like the contract's issues.
- **Rule names:** the runtime reads the app's name from the library's own channel (§4) and renders it `app.<name>`.
  - So an app rule never collides with a contract rule (`minLength`), and a client sees whose rule it is.
  - A name must match `[A-Za-z][A-Za-z0-9_.-]{0,63}` and must not be shaped like a UUID (Symfony's built-in codes).
  - A rule without a usable name renders `app.invalid`, and the runtime logs the fix once per rule. This covers:
    - a Laravel closure (`ClosureValidationRule`), an anonymous class, or `errors()->add()`;
    - a Symfony built-in constraint without a payload or a code;
    - a Pydantic `ValueError` or `assert` (`value_error`, `assertion_error`);
    - a DRF error without a code.
  - The app's names bypass the mapping the runtimes apply to contract rules (Python's `contract_rule()`).
- **No echoed values:** the library's message and the input value it may echo (Pydantic's `input`) never travel in the body, as for contract issues.
- **Messages:** no message field, which would need an IR change ([ADR 0005](0005-ir-evolution.md)). The name is the stable key a client translates.
- **Errors in a rule:** a rule that throws or rejects is a 500, logged with the operation and the part (a thrown error carries no rule name), like a hook that throws; its message never reaches the reply. The runtime awaits the call inside `try`, so a synchronous throw and a rejection take the same path.

### 4. Per family

| Family | The app writes, the library's documented way | Name read from | Registered through |
|---|---|---|---|
| zod | The part's schema (§2 "Part schemas"), with `.refine(fn, { path, params: { rule } })` or `.check(...)`; async allowed. The runtime calls `safeParseAsync`: through `~standard.validate` an async refine runs twice and a rejection escapes as an unhandled rejection that stops the process. | `params.rule` | `inputRules: { <operationId>: { <part>: schema } }` beside `hooks` in the registration options (Express, Fastify, Hono), the Adonis route registration, and `SeampactModuleOptions` (NestJS) |
| yup | The part's schema with `.test({ name, test })`; async allowed. The runtime calls `validate(value, { abortEarly: false })`, since yup's standard interface drops the name. | `inner[].type`, with `inner[].path` | same |
| class-validator (NestJS) | A subclass of the part's generated DTO (§2 "Part schemas"), or the app's own class for an inline body, with a custom constraint (`@ValidatorConstraint({ name })` and `@Validate`, or `registerDecorator({ name })`). The runtime calls the async `validate()` with the generated adapter's strict options without `whitelist` and `forbidNonWhitelisted`: step 6 already refused unknown keys, and the app's own class decorates only the members its rules read. For a constraint that injects providers, the app lists the constraint in its own module's providers and sets class-validator's container once, `useContainer(app.select(AppModule), { fallbackOnErrors: true })`, as Nest documents; the runtime never sets it, and `forRoot` registers no provider for it. A `@Validate` on a redeclared property drops that property's inherited decorators, which is harmless: step 6 already checked them. class-validator has no class-level constraint, so a cross-member or unnamed rule points at the member that carries it. | the constraint name | same; the value is the class |
| VineJS (AdonisJS) | A Vine schema using a rule from `vine.createRule`, reporting with `field.report(message, name, field)` | the reported rule | same |
| Ajv (Fastify) | A validate function compiled by the app's own Ajv instance, with its keywords added by `ajv.addKeyword`; a keyword on an object checks across members. The runtime awaits it when the schema is `$async`. | `errors[].keyword`, with `instancePath` | same |
| Laravel | A class implementing the generated `<Api>InputRules`: `operationId()`, `part()` and `rules()` in Laravel syntax, with `ValidationRule` classes (failing through `$fail`), built-in rules and `Rule::exists`. The runtime calls `Validator::make` on the part's array. | the failed rule's class short name, or the built-in rule name, first letter lowered (`EndAfterStart` gives `endAfterStart`, `After` gives `after`) | container tag `seampact.<api>.input_rules` |
| Symfony | A class implementing the generated `<Api>InputRules`: `operationId()`, `part()` and `constraints()`. Any constraint, including custom ones whose validator gets services by DI. The shortest cross-member form is a class-level constraint or `Callback` whose violation uses `atPath('end')`. The runtime calls `validate($part, $constraints)`, which runs only those constraints. | `payload['rule']`, else a code set with `setCode()`, else the custom constraint's short class name, first letter lowered | autoconfiguration, as `Decider` |
| Pydantic (FastAPI, Ninja), 1.2.0 | A subclass of the part's generated model (`<Op>Path`, `<Op>Query`, `<Op>Headers`, or the body's schema model), with `@field_validator` or `@model_validator`, raising `PydanticCustomError(name, ...)`. The runtime validates the copy §2 defines. A failing field validator hides the model-level one, as Pydantic does. | the error type | `bind_<api>(..., input_rules={"<operationId>": {"<part>": Model}})`, keyword-only, beside `access` and `operations` |
| DRF, 1.2.0 | A subclass of the generated serializer or the app's own, with `validate()` or `validate_<field>()`, raising `ValidationError(..., code=name)`. A bare message lands under `non_field_errors` and points at the part root. | `ErrorDetail.code` | `settings.SEAMPACT["<api>"]["input_rules"]`, dotted paths |
| Spring Boot, 1.2.0 | A bean implementing the generated per-operation `<Operation>InputRules`, which extends Spring's `Validator`, over the operation's input record. The runtime builds a `BeanPropertyBindingResult` and calls `ValidationUtils.invokeValidator`. A per-operation interface, since a generic one is erased and cannot be told apart by type. A field error's first path segment names the part (`body.end` gives `body`, pointer `/end`; a parameter component gives its declared part: `path`, `query` or `headers`). A global error (`reject`) points at `in: body`, pointer `""`; on an operation without a body it is a fault of the rule: a 500, logged once per rule with the fix "use `rejectValue` on a part member". | the error code | a bean, found by its interface |

**Async** runs where the library is async: zod, yup, class-validator, VineJS and Ajv `$async` schemas on Node. Pydantic, DRF, Laravel, Symfony and Spring rules are synchronous, as their libraries are. A rule that needs an async read on those targets stays in the handler.

**Typed on Node.** The generated code exports an `InputRules` type per api: for each operation and part with input, the configured library's schema type over that part's handler input type without the body proof fields, with optional members widened to `T | undefined` (with zod, `ZodType<unknown, Part>` over that widened part, the shape `z.output` gives); class-validator takes a class whose instances have the part's members. A misspelt operation id, a wrong part, a missing member or another library's schema does not compile. A schema with an extra required member still compiles; the suite case with a body proof field catches it. yup and VineJS infer an optional member as `T | undefined` on a required key, and zod adds `undefined` to an optional member, hence the widening. VineJS does not compile its own optional members under `exactOptionalPropertyTypes`, so the guide and the Vine type test turn that flag off. class-validator is checked on shape only, so the boot check verifies the class carries class-validator metadata. The boot check stays the run-time net.

### 5. Easy to extend

Adding a business rule stays one small step, in the library the app already uses:

- **Reuse:** a rule is written once (a rule class, a reusable refinement, a custom constraint) and used on several members and operations, the library's documented way.
- **Composition:** several rules combine on one part, in the library's own syntax.
- **App services:** a rule reaches app services through the framework's dependency injection where there is one (the Laravel container, Symfony services, Spring beans, Nest providers, FastAPI and Django request state). On Express, Fastify and Hono, it captures them in a closure.
- **No caller in this version:** a rule is not handed the principal the authenticate hook returned, and the runtimes do not write it into `auth()`, Symfony's `Security` or Spring's `SecurityContextHolder`. Those give the framework's own user only when the app also runs the framework's security. A rule about the caller stays in a decider or the handler. A principal argument can come later without changing a signature.
- **A new operation:** one registration entry, typed on Node and checked at boot everywhere.
- **Later extensions add, never change a signature:** rules on output, async on synchronous runtimes, a principal argument.

### 6. The boot check

Rules are optional, so a missing one is never a problem. The boot check refuses to start, at every `bootCheck.hooks` level, and lists every problem with the operation and the fix:

- rules for an operation id the api lacks, or that the entry's `operations` filter drops;
- rules for a part the operation has no input in;
- two rule sets for one operation and part;
- on Node, a value of the wrong kind for the configured library;
- on Python, a model that does not subclass its part's generated model;
- on NestJS, a class with no class-validator metadata;
- rules on a relay operation. The generated code marks each relay operation for this check (Python's contract module already does; the Node route table and the PHP and Spring generated contracts add the mark), and the relay operation keeps its `InputRules` key and interface, so the refusal names the relay and its public operation.

PHP checks when the container or the route cache is built, as ADR 0012 "The boot check" says.

### 7. What others see

- **Clients and OpenAPI:** unchanged. The `schemaInvalid` response is already declared on every operation that has input, and app rule names are plain strings.
- **`diff`:** cannot see a rule that narrows accepted input. The guide says that a rule clients depend on belongs in the contract when the grammar can say it.
- **`rules: seampact-consistent`:** promises the same answer from every client and server. App rules are server-only, so the guide says a pure rule a client also needs must be written in the client too.
- **The guide:** each [Types and validation](../types-and-validation/README.md) library page gains "Add your own rules". It also says:
  - a uniqueness check stays in the handler, as a declared 409;
  - a rule reading app data on a sign-up route can enable account enumeration, so use `throttle` or a uniform answer;
  - on NestJS, call `useContainer` for constraints that inject providers.

### 8. Tests

- **Shared suite case:** an http-suite case file, `input-rules`, run on every server sample app. Cases:
  - a contract issue only: the rule does not run (a counter proves it);
  - 401 and 403 before the rule;
  - a refusal gives the 400 with `{pointer: /end, rule: app.endAfterStart}` (the sample contracts' template drops `in`, §3);
  - a cross-member rule with no path points at `""`;
  - an operation with a body proof field: the rule sees the body without it and passes;
  - a rule that mutates its value leaves the handler's input unchanged;
  - a retry after success replays the 2xx;
  - a corrected retry after a refusal, with the same key, is checked again;
  - an unnamed rule gives `app.invalid`;
  - a code-named member (`endDate` in code, `end_date` on the wire) gives the wire pointer.
  - a rule that throws, and an async rule that rejects, give a 500 without their message, and the process keeps serving.
- **Boot variants:** an unknown operation, a part without input, a duplicate rule set, rules on a relay operation.
- **Types:** a Node `tsc` test that a misspelt operation id and another library's schema do not compile.
- **Unit tests, stable bricks only ([A47](../decisions.md#a47)):** each runtime's name and pointer mapping (Node: zod, yup, class-validator, VineJS, Ajv; PHP: Laravel `failed()` names, Symfony violations, the reverse walker; Python and Spring in 1.2.0), and the Node claim-release helper.
- **Docs:** the "Add your own rules" examples go through the docs excerpt check.
- **Existing tests:** the goldens are regenerated, never edited by hand (a new interface and the relay mark per api); the idempotency tests (`server-runtime/src/idempotency.test.ts`, `memory-idempotency-store.test.ts`, `python/codegen/tests/test_idempotency.py`) gain the release on a rule refusal; the boot check tests gain the new refusals. No existing test changes its expectation.
- **Where it runs:** the suite case is a required CI job on every server consumer. The order of the checks is proven there, not in a review.

### 9. Delivery

- **1.1.0:** the Node targets and the two PHP targets.
- **1.2.0:** Python and Spring Boot. Their suite case stays deferred by name until then.
- **No half delivery:** if Node and PHP are not ready together, the feature moves whole to 1.2.0.

## Consequences

- **[A45](../decisions.md#a45) is amended.** Rules come through a registered rules object, class or schema per operation and part (per operation on Spring), run at step 8b. Generated classes may stay `final`. The rest of A45 holds: no `extraRules` key in the contract, no per-target rule mapping in the config.
- **[ADR 0012](0012-access-hooks.md) "The check order" gains step 8b**, and its idempotency obligations gain the release on a rule refusal.
- **Each server target ADR (0016 to 0020, 0022 to 0024, 0026, 0027) gains one line** for its call site.
- **No grammar and no IR change.**

## Alternatives rejected

- **Subclasses merged into step 6 validation** (an extended FormRequest, a Pydantic subclass as the validation model, a subclassed DTO): the app's rules would run in the contract's pass. That is before the restricted-field and binding checks, it is inconsistent across targets (a user rule dropped on Laravel, a 500 on Symfony, an async Pydantic validator never awaited), and the generated classes are `final`.
- **The app's own FormRequest run at step 8b (Laravel):** it needs container, redirector and request glue, its `authorize()` cannot be skipped cleanly, and `validationData()` mixes the parts.
- **Validation mapping on the generated class (Symfony YAML):** a class renamed by `generate` drops the rule silently, and a stale property fails at the first request, not at boot.
- **A Bean Validation constraint (Spring):** it needs an annotation on the generated final records, so a mirror record or a provider-specific programmatic mapping.
- **Rules named in the contract:** A45 rejected it. A declared rule no target generates breaks "declared means derived".
- **A seampact rule helper, or any Standard Schema library on Node:** against the library-only rule above.
- **Rules on step 6's value:** it still holds the body proof fields, and a strict generated schema refuses them.
- **Rules before the idempotency claim:** a retry of a successful create would meet a rule that reads app data instead of its replay.
- **A rule answering any declared code:** it would make the hook a second handler. A refusal the client must tell apart is a declared code from the handler.
