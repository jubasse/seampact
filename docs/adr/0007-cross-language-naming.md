# ADR 0007: Cross-language naming

Status: accepted

## Context

Every named schema becomes a named type in every target, and every inline schema gets a deterministic name from its operation and role (ADR 0003). Generated names are explicit and stable (`AssignTaskInput`, `TasksEndpoints`). Targets are written in TypeScript, Kotlin and PHP and generate TypeScript, Java and PHP. If the IR held final identifiers, it would hold TypeScript's casing and reserved words, and each other language would re-split them by its own rules; two generators would then disagree on a name such as `userID` or a schema called `List`. FR-38 decides that the IR holds word segments plus a role, and that each target applies a small published algorithm checked by shared, language-neutral vectors (SCN-093).

## Options

1. Final identifiers in the IR, chosen for TypeScript; other targets convert.
2. Free-form names in the IR; each target splits and cases them its own way.
3. Word segments plus a role in the IR; one splitting rule in the compiler; per-language casing and escaping as a published algorithm with shared vectors.

Option 1 bakes one language into the IR. Option 2 lets targets disagree, which breaks determinism across ecosystems and the HTTP suite's expectations. Option 3 is chosen.

## Decision

### 1. Names in the IR

```ts
interface Name { segments: string[]; role: Role; status?: number }
```

- A segment is a non-empty string of lowercase ASCII letters and digits (`[a-z0-9]+`). Segments are checked, not trusted: an identifier is built only from such segments, `segments` must be an array of strings, a name whose words give nothing has no identifier (an error), and a role this version does not know is an error naming it (ADR 0005 open enums), never a guess.
- `status` is an integer, as everywhere in the IR (ADR 0004), from 200 to 399: success and redirect, what a `responses` entry admits (ADR 0002). A `response` name has it and no other role does; a missing, extra or malformed status is an error, never ignored.
- The role says what the name is for. It selects the identifier style and, for derived types, a suffix word.

| Role | Used for | Suffix word |
|---|---|---|
| `schema` | a declared schema, enum, scalar, right, scope, identity | none |
| `input`, `output`, `query`, `headers`, `path` | an operation's inline body, single success body, query, request headers, path parameters | `input`, `output`, `query`, `headers`, `path` |
| `response` | an inline body of a `responses` entry, even when the map has a single entry, so adding a second status renames nothing | `response` plus the status (`response`, `201`) |
| `params` | the params of a right, rule or error | `params` |
| `error` | the generated exception or error class of one error code (ADR 0012) | `error` |
| `errors` | an operation's typed error result, the union of its codes | `errors` |
| `property` | an inline object or union held by a property | none (the property's segments follow the parent's) |
| `item`, `value` | an inline object as an array item or a map value | `item`, `value` |
| `variant` | an inline union variant | none (the tag's segments follow the union's) |
| `endpoints` | the generated interface of a resource or tag | `endpoints` |
| `operation` | an operation | none |
| `member` | a property or a parameter, as an identifier | none |
| `enumMember` | an enum value, as an identifier | none |

The wire name of a property, parameter, header or enum value stays a separate string in the IR (ADR 0004); a `Name` only drives identifiers. A property's `codeName`, a right's `codeName` and an enum's `codeNames` (ADR 0003 section 6, ADR 0002 sections 9 and 12) replace the segments split from the wire name, for an identifier the wire name makes poor; they never change the wire.

### 2. Splitting a written name into segments

The compiler splits every name written in a contract (a schema name, a node name, an enum value, a property, a right, an error code) once, with this rule:

1. Treat every character outside `A-Z`, `a-z`, `0-9` as a separator (`_`, `-`, `.`, space).
2. Inside a run of letters and digits, split before an uppercase letter that follows a lowercase letter or a digit (`userId` gives `user`, `id`; `2FA` gives `2`, `fa`, so a type is `_2Fa` and `2fa` gives `_2fa`), and before an uppercase letter that is followed by a lowercase letter and preceded by an uppercase letter (`HTTPServer` gives `http`, `server`; `userID` gives `user`, `id`).
3. Never split around digits (`oauth2Token` gives `oauth2`, `token`; `v2` stays `v2`).
4. Lowercase every segment and drop empty ones.

A name that yields no segment is an error (`no-segment`) in every context except an enum value written without segments (such as `+`), which gets the single segment `value` followed by its one-based position in the enum (`value3`); an enum value always carries its one-based position. A `codeName` that yields no segment is an error for every source: the fallback does not apply to it. A right takes the name its library uses (ADR 0002 section 4), so it may yield none (`*`); such a right is a compile error naming it, with the fix: set its `codeName`. An error code always yields at least one segment, since its alphabet starts with a letter or a digit. Two names of one scope that yield equal segments (two properties of one object, two values of one enum, two schemas, two operations) are a compile error naming both, because they would collide in every language; this check runs once, in the tree pass, instead of in every target.

### 3. Derived names

An inline schema is named from its position (FR-3, SCN-033): the segments of its owner followed by the suffix word of its role.

| Position | Example | Name |
|---|---|---|
| the inline input of `assignTask` | `{ segments: [assign, task], role: input }` | `AssignTaskInput` |
| the inline `201` body of `createTask` among several statuses | `[create, task]`, `response` | `CreateTaskResponse201` |
| the query of `listTasks` | `[list, tasks]`, `query` | `ListTasksQuery` |
| the params of right `tasks.update` | `[tasks, update]`, `params` | `TasksUpdateParams` |
| the params of error `api.rate_limited` | `[api, rate, limited]`, `params` | `ApiRateLimitedParams` |
| the exception of error `tasks.locked` | `[tasks, locked]`, `error` | `TasksLockedError` |
| the error result of `updateTask` | `[update, task]`, `errors` | `UpdateTaskErrors` |
| the params of error `1042` | `[1042]`, `params` | `_1042Params` (section 4) |
| the inline object of property `address` of `Order` | `[order, address]`, `property` | `OrderAddress` |
| the inline variant `assigned` of union `Notice` | `[notice, assigned]`, `variant` | `NoticeAssigned` |
| the interface of resource `tasks` | `[tasks]`, `endpoints` | `TasksEndpoints` |
| operation `assign` under the member of `tasks` | `[assign, task]`, `operation` | `assignTask` |

The canonical identifier that ADR 0004 uses as an id is the TypeScript form of the name: PascalCase for derived schema ids. An operation id is the exception: its string follows `conventions.operationIds` (ADR 0002 section 6) everywhere it appears, the IR's `Operation.id`, the OpenAPI `operationId`, and the operation names `relays`, `deprecated.successor` and `seampact explain` take, so `case: snake` makes `list_tasks` the id in all of them; camelCase is only its default. Generated method names still come from the segments through section 4 (`listTasks` in TypeScript). The owner of an inline schema held by a derived schema is the derived schema's whole name: its segments followed by its default suffix words (the `scope` property of the inline params of right `roles` gives `[roles, params, scope]`, `RolesParamsScope`). Without the suffix words, the children of one operation's inline input and output would collide, and so would a child of `RolesParams` and the same child of a declared `Roles`. A target's `suffixes` option (section 5) renames the derived schema only, not the word its children carry.

An operation id string is pure casing: no reserved-word escape and no leading `_`, because it is neither a code identifier nor a plain-object key. The method name generated from the same segments is an identifier and is escaped. The canonical id of a derived name that is not an operation is its escaped TypeScript identifier (`_404GoneError`, `List_`); an enum member has none.

A derived name equal to a declared one is a compile error naming both, with the fix "rename the schema or set `operationId`".

### 4. Identifiers per language

Casing joins the segments, then appends the suffix words:

| Style | Rule | `[assign, task]` + `input` |
|---|---|---|
| Pascal | each segment with its first letter uppercased | `AssignTaskInput` |
| camel | Pascal with the first letter lowercased | `assignTaskInput` |
| upper snake | segments uppercased, joined by `_` | `ASSIGN_TASK_INPUT` |
| snake | segments joined by `_` | `assign_task_input` |

| Role | TypeScript | Kotlin and Java | PHP | Python |
|---|---|---|---|---|
| types (`schema`, derived types, `endpoints`) | Pascal | Pascal | Pascal | Pascal |
| `operation`, `member` | camel | camel | camel | snake |
| `enumMember` | none (enums are string literal unions) | upper snake | Pascal (enum cases) | upper snake |

The first letter of each Pascal segment is uppercased and a digit stays as it is (`_404Gone`).

Python follows PEP 8: Pascal classes, snake case attributes and functions, upper snake enum members (as a `StrEnum` names them).

An identifier whose first segment starts with a digit gets a leading `_`, in every role. A declared schema name starts with a letter, but an error code may start with a digit (`1042`, `404-gone`, ADR 0002 section 4), and so do the types derived from it: its params type and its exception give `_1042Params` and `_404GoneError`. A member or enum member gives `_2fa`, `_2FA`; split segments keep their `_` in the snake styles. The suffix words stay last, so `suffixes` renames them as for any other name.

A Python member is the exception: Pydantic keeps a name with a leading `_` as a private attribute, never as a field, so a member whose first segment starts with a digit takes the prefix `field_` instead (`2fa` gives `field_2fa`, `2FA` gives `field_2_fa`); Python types, operations and enum members keep the leading `_`. Since a written `field_2fa` gives the same identifier, the Python generators refuse two members of one object that give the same identifier, naming both and locating them; the compiler's collision check stays language-neutral and compares canonical ids.

The `Status` and `ErrorCode` keys of generated code follow the same rule: a status takes its IANA reason phrase in PascalCase (`NotFound`); an error code takes the whole code (`ApiNotFound` for `api.not-found`).

### 5. Reserved words and shadowed names

After casing, an identifier that collides with a reserved word or a shadowed name of the target language gets a trailing `_` (`List_`, `class_`, `Error_`). The test runs on the final identifier, after casing and the leading `_`, per language and per role: keywords of the language escape every role, shadowed type names escape the type roles only, and a few names that break a class or a record escape members and operations too, since escaping is the safe default (`constructor` and `prototype` in TypeScript, `hashCode`, `toString`, `clone`, `finalize`, `getClass`, `notify`, `notifyAll` and `wait` as a Java record component or method, `this` in PHP). One rule for every language keeps it predictable and visibly an escape. The casings of section 4, the suffix words of section 1 and this escape are defaults, not conventions imposed on the consumer ([A36](../decisions.md#a36)): a target may offer options for its own language, applied after the shared algorithm and recorded in the target's options, so generation stays deterministic; the shared vectors test the defaults. The TypeScript API takes them as `identifier(name, language, { suffixes, escape, enumCase })`; `handlers` acts above the naming algorithm and is not part of it. Every target offers at least:

- `suffixes`: the word of each derived role (`input: dto` gives `AssignTaskDto` in a NestJS habit, `input: request` gives `AssignTaskRequest` in a Java one);
- `escape`: the reserved-word escape, a suffix or a prefix;
- `enumCase`: the casing of enum members, where the language has them;
- `handlers`: how operations are grouped into generated interfaces, `perResource` (the default, `TasksEndpoints`), `perTag`, or `perOperation` (one interface per operation, for single-action controllers such as Laravel's and Symfony's `__invoke`).

The lists, part of the published algorithm:

- TypeScript: the reserved and strict-mode words of ECMAScript; for types, the global names a generated module would shadow, such as `Array`, `Boolean`, `Date`, `Error`, `Function`, `Headers`, `JSON`, `Map`, `Math`, `Number`, `Object`, `Partial`, `Promise`, `Record`, `RegExp`, `Request`, `Response`, `Set`, `String`, `Symbol`, `URL`.
- Java and Kotlin: the keywords and literals of both languages (Kotlin's keywords are its hard keywords, Java's the JLS keywords, and Kotlin shadows the names it imports by default where Java does not); for types, every simple name of `java.lang` (`Error`, `Exception`, `Integer`, `Object`, `Override`, `Record`, `String`, `Thread` and the rest), the names Kotlin imports by default that a generated type would shadow (`Any`, `Unit`, `Nothing`, `Pair`, `Result`), and the collection types generated code uses unqualified (`List`, `Map`, `Set`, `Collection`, `Iterable`, `Optional`).
- PHP: the reserved keywords and reserved class names, compared case-insensitively because PHP class names are, and blocking class names only, since PHP allows them as method, property and class constant names (the one enum case it refuses is `class`) (`List`, `Match`, `Enum`, `Readonly`, `Fn`, `Array`, `Object`, `String`, `Int`, `Float`, `Bool`, `Mixed`, `Never`, `Void`, `Null`, `True`, `False`, `Iterable`, `Callable`, `Parent`, `Self`, `Static`).
- Python: the keywords and soft keywords (`match`, `case`, `type`, `_`, `lazy`), compared case-sensitively; for types, the capitalized builtins a generated class would shadow (`Exception`, `Warning` and the other builtin exceptions, `Ellipsis`, `NotImplemented`); for members and operations, the other builtins (`list`, `dict`, `str`, `int`, `id`, `filter`, `format`, `hash`, `input`, `len`, `map`, `max`, `min`, `next`, `open`, `range`, `set`, `sum` and the rest) and the attributes of Pydantic's `BaseModel` a field would shadow (`model_config`, `model_dump` and the other `model_*` attributes, as exact names, `copy`, `dict`, `json`, `schema`, `construct`, `validate`, and the metaclass attributes `register` and `mro`). The list does not hold the names generated code imports (`date`, `BaseModel`, `Field`), since generated Python imports them qualified or under a private alias. The trailing `_` is PEP 8's own habit (`class_`). The list is the union of Python 3.12.16 and 3.15.2, the oldest and the latest Python the targets support. Keywords are `keyword.kwlist` and `keyword.softkwlist`; a soft keyword is escaped though Python accepts it as a name. Types are the public names of `dir(builtins)` that start with an uppercase letter, members the other public names, read under `python -S`, so the helpers `site` adds (`exit`, `help`, `license`) are not in it. Members add the public names of `dir(pydantic.BaseModel)` and `dir(type(pydantic.BaseModel))` on Pydantic 2.14.2. A keyword is not repeated in the other lists. The lists hold exact names: a prefix rule, such as Pydantic's protected `model_dump` and `model_validate` namespaces, is not part of them. The Python list is re-read when the CI of the Python targets moves its latest Python or the supported Pydantic range moves: the re-read is a naming-list PR on `@seampact/spec` that updates the versions in `source`, and since a new word renames generated code, it takes the IR change path below.

The exact lists ship with the vectors. Adding a language, its list and its column of the vectors, is additive and not an IR change: no IR value and no identifier of an existing language changes, so `irRevision` stays. A change to an existing list or vector renames generated code and takes the IR change path (ADR 0005).

### 6. Shared test vectors

`@seampact/spec` publishes `naming/vectors.json`, language-neutral. The TypeScript implementation lives in `@seampact/spec/naming`, because the compiler's tree pass needs the splitting and the derived names before any target exists. The reserved-word lists ship as `naming/reserved-words.json` beside the vectors (a list per language, Python included, and a `python` identifier in every vector), with `reserved-words.schema.json` and `vectors.schema.json` describing the two files (the vectors are an array sorted by id).

```json
{ "written": "List", "role": "schema",
  "segments": ["list"],
  "expected": { "typescript": "List", "kotlin": "List_", "java": "List_", "php": "List_" } }
```

Each vector gives a written name (or segments and an owner, for derived names), the role, the expected segments, and the expected identifier per language. The set covers the splitting cases of section 2, every derived role of section 3 (the `error` and `errors` roles included), leading digits in members and in types derived from a digit-led error code, empty enum values, a right without segments and its `codeName`, and the reserved and shadowed names, including schemas named `list`, `match`, `record`, `error` and `promise` (SCN-093). The TypeScript implementation in `@seampact/spec/naming`, the Kotlin implementation in `seampact-ir`, which both the Gradle and the Maven plugin use, and the PHP implementation in `seampact/ir` (ADR 0010) each run the whole file in their test suites, and each is about thirty lines (FR-40). A target for another ecosystem passes the same file.

### 7. Generated modules

Generated names are scoped by ES module namespace imports, not by a generated object or a TypeScript `namespace`. Each target writes one `index.ts` per api (`<out>/<api>/index.ts`) that re-exports that api's modules flat (`export *`), and names are unique within one module; a role whose names repeat another module of the same target goes under a sub-namespace named by its role (`schemas`, `inputSchemas`, `outputSchemas`), and a module with internals, such as the fetch runtime, re-exports its public names by an explicit list. Two targets or two apis may export the same name. The docs and examples show namespace imports (`import * as TasksNest from '.../tasks/nestjs'`, `import type * as Tasks from '.../tasks/types'`); flat imports stay allowed ([A36](../decisions.md#a36)).

## Consequences

- No target splits or re-cases a name on its own; two generators always agree on an identifier, and a rename shows in the IR diff.
- Name collisions are found once, by the compiler, with a located diagnostic, instead of as a compile error in generated Java or PHP.
- The trailing `_` escape makes generated names such as `List_` slightly unusual; it is predictable, and a contract author who dislikes it renames the schema or sets the target's `escape` option.
- Reserved-word lists are part of the IR contract: adding a word to an existing language's list is an IR change, since it renames generated code.

## Traceability

- FRs: FR-38 (segments and role, per-language escaping, shared vectors), FR-3 (deterministic names for inline schemas), FR-40 (native implementations pass the vectors), FR-14 (byte-identical generation).
- Scenarios: SCN-033, SCN-093, SCN-095.
- CHK items enabled: CHK-024 (named union variants), CHK-002 (named types at scale compile), CHK-078 (naming is part of the stable IR contract), CHK-146 (code names, suffixes, handler grouping), CHK-173 (error roles, digit-led codes, rights without segments).
