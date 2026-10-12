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
interface Name { segments: string[]; role: Role }
```

- A segment is a non-empty string of lowercase ASCII letters and digits (`[a-z0-9]+`).
- The role says what the name is for. It selects the identifier style and, for derived types, a suffix word.

| Role | Used for | Suffix word |
|---|---|---|
| `schema` | a declared schema, enum, scalar, right, scope, identity | none |
| `input`, `output`, `query`, `headers`, `path` | an operation's inline body, single success body, query, request headers, path parameters | `input`, `output`, `query`, `headers`, `path` |
| `response` | an inline success body of one status among several | `response` plus the status (`response`, `201`) |
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
2. Inside a run of letters and digits, split before an uppercase letter that follows a lowercase letter or a digit (`userId` gives `user`, `id`), and before an uppercase letter that is followed by a lowercase letter and preceded by an uppercase letter (`HTTPServer` gives `http`, `server`; `userID` gives `user`, `id`).
3. Never split around digits (`oauth2Token` gives `oauth2`, `token`; `v2` stays `v2`).
4. Lowercase every segment and drop empty ones.

A name that yields no segment (an enum value such as `+`) gets the single segment `value` followed by its one-based position in the enum (`value3`). That fallback is for enum values only. A right takes the name its library uses (ADR 0002 section 4), so it may yield none (`*`); such a right is a compile error naming it, with the fix: set its `codeName`. An error code always yields at least one segment, since its alphabet starts with a letter or a digit. Two names of one scope that yield equal segments (two properties of one object, two values of one enum, two schemas, two operations) are a compile error naming both, because they would collide in every language; this check runs once, in the tree pass, instead of in every target.

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

The canonical identifier that ADR 0004 uses as an id is the TypeScript form of the name: PascalCase for derived schema ids. An operation id is the exception: its string follows `conventions.operationIds` (ADR 0002 section 6) everywhere it appears, the IR's `Operation.id`, the OpenAPI `operationId`, and the operation names `relays`, `deprecated.successor` and `seampact explain` take, so `case: snake` makes `list_tasks` the id in all of them; camelCase is only its default. Generated method names still come from the segments through section 4 (`listTasks` in TypeScript). A derived name equal to a declared one is a compile error naming both, with the fix "rename the schema or set `operationId`".

### 4. Identifiers per language

Casing joins the segments, then appends the suffix words:

| Style | Rule | `[assign, task]` + `input` |
|---|---|---|
| Pascal | each segment with its first letter uppercased | `AssignTaskInput` |
| camel | Pascal with the first letter lowercased | `assignTaskInput` |
| upper snake | segments uppercased, joined by `_` | `ASSIGN_TASK_INPUT` |

| Role | TypeScript | Kotlin and Java | PHP |
|---|---|---|---|
| types (`schema`, derived types, `endpoints`) | Pascal | Pascal | Pascal |
| `operation`, `member` | camel | camel | camel |
| `enumMember` | none (enums are string literal unions) | upper snake | Pascal (enum cases) |

An identifier whose first segment starts with a digit gets a leading `_`, in every role. A declared schema name starts with a letter, but an error code may start with a digit (`1042`, `404-gone`, ADR 0002 section 4), and so do the types derived from it: its params type and its exception give `_1042Params` and `_404GoneError`. A member or enum member gives `_2fa`, `_2FA`. The suffix words stay last, so `suffixes` renames them as for any other name.

### 5. Reserved words and shadowed names

After casing, an identifier that collides with a reserved word or a shadowed name of the target language gets a trailing `_` (`List_`, `match_`, `Error_`). One rule for every language keeps it predictable and visibly an escape. The casings of section 4, the suffix words of section 1 and this escape are defaults, not conventions imposed on the consumer ([A36](../decisions.md#a36)): a target may offer options for its own language, applied after the shared algorithm and recorded in the target's options, so generation stays deterministic; the shared vectors test the defaults. Every target offers at least:

- `suffixes`: the word of each derived role (`input: dto` gives `AssignTaskDto` in a NestJS habit, `input: request` gives `AssignTaskRequest` in a Java one);
- `escape`: the reserved-word escape, a suffix or a prefix;
- `enumCase`: the casing of enum members, where the language has them;
- `handlers`: how operations are grouped into generated interfaces, `perResource` (the default, `TasksEndpoints`), `perTag`, or `perOperation` (one interface per operation, for single-action controllers such as Laravel's and Symfony's `__invoke`).

The lists, part of the published algorithm:

- TypeScript: the reserved and strict-mode words of ECMAScript; for types, the global names a generated module would shadow, such as `Array`, `Boolean`, `Date`, `Error`, `Function`, `Headers`, `JSON`, `Map`, `Math`, `Number`, `Object`, `Partial`, `Promise`, `Record`, `RegExp`, `Request`, `Response`, `Set`, `String`, `Symbol`, `URL`.
- Java and Kotlin: the keywords and literals of both languages; for types, every simple name of `java.lang` (`Error`, `Exception`, `Integer`, `Object`, `Override`, `Record`, `String`, `Thread` and the rest), the names Kotlin imports by default that a generated type would shadow (`Any`, `Unit`, `Nothing`, `Pair`, `Result`), and the collection types generated code uses unqualified (`List`, `Map`, `Set`, `Collection`, `Iterable`, `Optional`).
- PHP: the reserved keywords and reserved class names, compared case-insensitively because PHP class names are (`List`, `Match`, `Enum`, `Readonly`, `Fn`, `Array`, `Object`, `String`, `Int`, `Float`, `Bool`, `Mixed`, `Never`, `Void`, `Null`, `True`, `False`, `Iterable`, `Callable`, `Parent`, `Self`, `Static`).

The exact lists ship with the vectors and change only through an IR change PR (ADR 0005), because a new reserved word renames generated code.

### 6. Shared test vectors

`@seampact/spec` publishes `naming/vectors.json`, language-neutral:

```json
{ "written": "List", "role": "schema",
  "segments": ["list"],
  "expected": { "typescript": "List", "kotlin": "List_", "java": "List_", "php": "List_" } }
```

Each vector gives a written name (or segments and an owner, for derived names), the role, the expected segments, and the expected identifier per language. The set covers the splitting cases of section 2, every derived role of section 3 (the `error` and `errors` roles included), leading digits in members and in types derived from a digit-led error code, empty enum values, a right without segments and its `codeName`, and the reserved and shadowed names, including schemas named `list`, `match`, `record`, `error` and `promise` (SCN-093). The TypeScript implementation in codegen-core, the Kotlin implementation in `seampact-ir`, which both the Gradle and the Maven plugin use, and the PHP implementation in `seampact/ir` (ADR 0010) each run the whole file in their test suites, and each is about thirty lines (FR-40). A target for another ecosystem passes the same file.

## Consequences

- No target splits or re-cases a name on its own; two generators always agree on an identifier, and a rename shows in the IR diff.
- Name collisions are found once, by the compiler, with a located diagnostic, instead of as a compile error in generated Java or PHP.
- The trailing `_` escape makes generated names such as `List_` slightly unusual; it is predictable, and a contract author who dislikes it renames the schema or sets the target's `escape` option.
- Reserved-word lists are part of the IR contract: adding a word is an IR change, since it renames generated code.

## Traceability

- FRs: FR-38 (segments and role, per-language escaping, shared vectors), FR-3 (deterministic names for inline schemas), FR-40 (native implementations pass the vectors), FR-14 (byte-identical generation).
- Scenarios: SCN-033, SCN-093, SCN-095.
- CHK items enabled: CHK-024 (named union variants), CHK-002 (named types at scale compile), CHK-078 (naming is part of the stable IR contract), CHK-146 (code names, suffixes, handler grouping), CHK-173 (error roles, digit-led codes, rights without segments).
