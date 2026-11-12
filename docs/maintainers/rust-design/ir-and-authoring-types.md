# Rust design: the IR and authoring types

The data every 2.0.0 port lane builds on: the IR types, the opaque JSON value, numbers, and what the loader hands to the passes. It applies [PORTING.md](../../../PORTING.md) and [ADR 0031](../../adr/0031-rust-core.md) to the IR of [ADR 0004](../../adr/0004-ir-shape.md) and the pass halves of [ADR 0006](../../adr/0006-compiler-pass-pipeline.md). A port lane uses these shapes as given; a gap goes to the lead, not into a local variant.

The IR JSON Schema (`packages/core/spec/schemas/ir/`) stays the source of the IR. The Rust types are written by hand from it and held to it by tests (section 8). Each decision below gives its reason; the evidence comes from a throwaway spike run on every expected output of `fixtures/expected/`.

## 1. Crates

| Crate | Directory | Holds | Depends on |
|---|---|---|---|
| `seampact-js` | `crates/js` | UTF-16 order (`cmp_utf16`), object key order (`js_key_order`), the ECMAScript number-text helper (lands with the writer seam, its first consumer) | `ryu-js` for the number-text helper |
| `seampact-json` | `crates/json` | `JsonValue`, `JsonNumber`, `JsonObject`, the JSON Pointer escape, the canonical writer | `seampact-js`, `serde`, `serde_json`, `indexmap` |
| `seampact-ir` | `crates/ir` | the IR and source-map types, `IrMap`, `IR_REVISION`, the IR schema files (embedded), then the reader helpers as their ports land: union tags, support check, closed check, invariants | `seampact-json`, `seampact-js`, `serde`, `serde_json`, `indexmap` |
| `seampact-ir-check` | `crates/ir-check` | the IR JSON Schema validator (finalize's strict check, an imported IR's check) and the shared `JsonValue` to `serde_json::Value` conversion for validation (section 3) | `seampact-ir`, `seampact-json`, `jsonschema` |
| `seampact-authoring` | `crates/authoring` | the grammar data (embedded authoring schemas, markers, keywords, reserved names), the loaded tree the loader hands over, the typed member readers | `seampact-json`, `seampact-ir`, the span types of the spans and diagnostics seam |

- One crate per concept, so a generator depends on `seampact-ir` and `seampact-json` only, and never builds `jsonschema` and its numeric stack (`num-bigint`, `fraction`): only the compiler, the CLI and readers of imported IR depend on `seampact-ir-check`. The IR is the only input of every generator (ADR 0004), so no generator can read the authoring tree.
- `JsonValue` sits below both the IR and the authoring tree: an example the author writes reaches the IR unchanged, with no conversion between two value types.
- The canonical writer lives in `seampact-json` because it writes a `JsonValue`. Its internals belong to the writer seam (section 9).
- The crates are not published (ADR 0031), so the public enums stay exhaustive, with no `#[non_exhaustive]`. A new variant then breaks every `match` at compile time, which is what an IR change should do.

## 2. Shapes

Rust type names are the schema's definition names (`ErrorDecl`, `TypeUse`), and fields keep the schema's property order (the order of `types.writer.generated.ts`). Member names map through `#[serde(rename_all = "camelCase")]`. A Rust keyword is written as a raw identifier (`r#type`, `r#in`, `r#enum`), so the name matches the schema without an alias. The schema subset of the IR README maps as follows.

| Schema construct | Rust |
|---|---|
| object definition | `struct`, `Debug, Clone, PartialEq, Serialize, Deserialize` |
| member in `required` | `T` |
| member outside `required` | `Option<T>`, `#[serde(default, skip_serializing_if = "Option::is_none")]` |
| optional boolean (`noStore`, `nullable` on a type use) | `Option<bool>`: absent and `false` are different bytes |
| opaque value `{}` (`example`, `default`, extension and convention values) | `JsonValue`; optional: `Option<JsonValue>` read with `present` (below) |
| integer member (from -(2^53 - 1) to 2^53 - 1) | `i64`, never a narrower type, decoded through the shared JS-integer deserializer (below) |
| numeric refinement | `DecimalLiteral(String)` newtype |
| id definition (`SchemaId`, `ErrorCode`, `RightId`...) | newtype over `String`, `#[serde(transparent)]`, `Eq + Hash` |
| catalogue (`additionalProperties` with `propertyNames`) | `IrMap<Id, T>` (section 6) |
| plain map (`additionalProperties` without `propertyNames`: `Enum.codeNames`, `WireFormat.meta`, `Conventions`, `Lint.rules`, `Operation.examples`) | `IrMap<String, T>`; keys can be array-index keys (`codeNames` is keyed by enum values), so the key-order rule of section 6 applies |
| array | `Vec<T>`; the producer keeps the order of ADR 0004 section 9 |
| open enum (`x-seampact-known`) | `enum` of the known values plus `Unknown(UnknownValue)` |
| tagged union (`discriminator` + `oneOf`) | `enum` with one variant per variant struct plus `Unknown(UnknownVariant)` |
| `Origin.layer` (closed pattern) | `enum Layer { Api, Shared, Base, Core, Workspace, Pack(PackName) }`; any other text is a decode error |
| recursion (`ArrayTypeUse.items`, `JsonContent.schema`) | `Box<TypeUse>` |

Absent, `null` and a default are three different things in the IR bytes, and the types keep them apart:

```rust
pub struct ErrorDecl {
    pub code: ErrorCode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    pub nature: NatureBase,
    pub http: ErrorHttp,
    // serde reads a present `null` as `None` for `Option<T>`; `present` reads it as `Some(JsonValue::Null)`.
    #[serde(default, deserialize_with = "present", skip_serializing_if = "Option::is_none")]
    pub example: Option<JsonValue>,
    pub docs: Docs,
    pub origin: Origin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_store: Option<bool>,
}
```

- Never put `#[serde(default)]` on a non-`Option` member: it would write a default where the TypeScript wrote nothing.
- No `#[serde(flatten)]`. It decodes through a buffer and hides which struct owns a member. The members every type use shares are repeated in each variant struct, as the schema repeats them.
- An integer member decodes with JavaScript semantics, as the schema's `integer`, Ajv and the TypeScript reader do: any JSON number whose `f64` passes `Number.isInteger` and the definition's range becomes `i64`, so `404`, `404.0` and `4.04e2` read alike; anything else is a decode error. One shared deserializer (`#[serde(deserialize_with)]`) does it for every integer member; a plain `i64` derive refuses `404.0`. A reader validates the raw value against the schema before the typed decode, so a schema fault gets the validator's diagnostic, as in TypeScript.
- Id newtypes tell kinds apart and check nothing. The id grammar is a diagnostic with a position (tree pass) and a schema check (finalize), not a type error. Their constructor is `new(String)`, and they expose `as_str` and `Display`.
- The structs whose members depend on one deciding member (`ValueSource`, `FieldWire`, `MetaMember`, `HeaderDecl`, `Cache`) stay structs with `Option` members, as the schema writes them. An unknown deciding value must still read, and the invariant port checks the members.

### Open enums and unions: one type family

The TypeScript has two views: the open reader types and the closed writer view (`IrWriter`). Rust keeps one family. The unknown arm holds a type with no public constructor, so a pass cannot build an unknown tag or value from text. Visibility does not enforce the closed writer view: `Deserialize` and `Clone` are public ways to get an `Unknown` into a draft. What guards the writer side is what guards it in TypeScript: the closed check (`checkIrClosedDeclaration`) before a declaration is copied, and finalize's strict schema check. One family halves the types and keeps every `match` exhaustive.

```rust
pub struct UnknownValue(String);                                // no public constructor
pub enum NatureBase { Refused, Unavailable, Failed, Unknown(UnknownValue) }

pub struct UnknownVariant { tag: String, raw: JsonValue }       // no public constructor; written back as `raw`
pub enum TypeUse {
    Ref(RefTypeUse), Opaque(OpaqueTypeUse), File(FileTypeUse),
    Enum(EnumTypeUse), Scalar(ScalarTypeUse), Array(ArrayTypeUse),
    Unknown(UnknownVariant),
}
```

- Two `macro_rules!` macros, `open_enums!` and `ir_unions!`, write the enums, `as_str`, serde and a registry: `OPEN_ENUMS` and `UNIONS`, each entry holding the definition name, the tag member and the known values or tags. One invocation per macro lists every definition, so the registry cannot miss one (section 8).
- A union's `Serialize` writes the tag, then the variant's members; for `Unknown`, it writes `raw`. Its `Deserialize` reads one `serde_json::Value`, takes the tag (a missing or non-string tag is a decode error, as the schema has it), and decodes the chosen variant alone with `serde_json::from_value`. Serde's `#[serde(tag)]` derive is not used for decoding: it has no arm that keeps the raw object, and under `arbitrary_precision` it fails on any `f64` below it (section 3).
- The variant structs do not hold the tag member; the enum variant is the tag.
- A reader that acts on a value refuses `Unknown` by name (the IR README, "Readers"). A pass matching a value from its own draft treats `Unknown` as a bug and reports the internal diagnostic.
- Must-act definitions carry a `MUST_ACT` flag in the registry, for the validator port.

### Unknown members

Readers ignore unknown members (ADR 0005), so the types never use `deny_unknown_fields`, and a typed decode drops unknown members. The closed check (`checkIrClosedDeclaration`) needs them, so a reader of an imported IR keeps the raw `JsonValue` of the document beside the typed `ContractIr`. The closed check walks the raw value with the schema, as the TypeScript does. A declaration is copied from the typed value only once that check passes. Finalize's strict schema check stays the safety net.

## 3. Numbers

Decision: `serde_json` is built with `preserve_order` and `arbitrary_precision`, and `jsonschema` with `default-features = false, features = ["arbitrary-precision"]`, once, in `[workspace.dependencies]`. The IR and authoring types never hold a `serde_json::Number`: an opaque number is a `JsonNumber`, an IR integer member an `i64`.

Reason: without `arbitrary_precision`, serde_json keeps an integer exact only within 64 bits and turns a wider one into an `f64` without saying so. The spike read `100000000000000000000000000001` back as `1e+29`, and `-9223372036854775809` as `-9223372036854776000`. An imported IR, a diff or a relay copy would then change digits that ADR 0031 keeps exact. With the feature on, every width stays exact, and the spike found no cost: the same 178 files byte-identical, the same validation result and time.

```rust
pub struct JsonNumber(Repr);                 // opaque: every value is finite, as JSON has it
enum Repr { Finite(f64), ExactInteger { digits: Box<str>, rounded: f64 } }

impl JsonNumber {
    pub fn from_f64(value: f64) -> Option<Self>;           // None when not finite
    pub fn from_json_text(text: &str) -> Option<Self>;     // integer text above 2^53 keeps its digits
    pub fn to_f64(&self) -> f64;                           // the value JavaScript holds
    pub fn exact_digits(&self) -> Option<&str>;
}
impl PartialEq for JsonNumber { /* f64 ==, as JavaScript ===: 0 == -0, 2^53 + 1 == 2^53 */ }
impl Eq for JsonNumber {}                    // sound: every value is finite
impl Hash for JsonNumber { /* if needed: hashes to_f64 with -0 normalised to 0, to agree with PartialEq */ }
impl fmt::Display for JsonNumber { /* ECMAScript number text, or the exact digits */ }
```

- An exact integer is canonical decimal text (an optional `-`, no leading zero) whose magnitude is above 2^53. 2^53 itself and every smaller integer are `f64`, which holds them exactly and gives the same text. A JSON number in exponent or fraction form is an `f64`, as in TypeScript.
- The `f64` is computed once, at construction. Comparisons and arithmetic the TypeScript makes on `number` use `to_f64` (PORTING section 2), so an exact integer compares as the rounded value it was in 1.x. Only the written text differs, and `differences.yaml` records that.
- `JsonValue` derives `PartialEq` through this equality, so IR equality follows JavaScript. `seampact diff` therefore reports two examples that differ only past 2^53 as equal while their IR bytes differ, as in 1.x; that is intended.
- `JsonValue` implements `TryFrom<serde_json::Value>`, reading a number from `Number::as_str()`. It is fallible: serde_json accepts `1e400` under the feature, and `from_json_text` returns `None` for it. The error names the JSON pointer of the number; there is no fallback value.
- `JsonValue`'s `Serialize` targets serde_json only, and its rustdoc says so. It writes an exact integer through `serde_json::Number` (exact under the feature), an integral `f64` within 2^53 as an integer, and any other `f64` as a float, as `JSON.stringify` does. The canonical writer and the OpenAPI YAML emitter consume `JsonValue` directly, writing numbers with the number-text helper; a test checks that a number in OpenAPI YAML is a scalar.
- `serde_json` also keeps `float_roundtrip`, for any typed `f64` decode outside the IR and authoring types. Under `arbitrary_precision` a `Value` keeps the number text, and `JsonNumber` parses it with `str::parse`, which is correctly rounded, as `JSON.parse` is.

What the feature changes for every serde_json user, and the rule for each:

| Effect | Rule |
|---|---|
| A serde derive that buffers (`#[serde(tag)]`, `untagged`, adjacently tagged) fails on an `f64` member: `invalid type: map, expected f64` (spike; `i64` members and `flatten` decoded) | no `f64` in a serde-derived type; a JavaScript number in a serde type is a `JsonNumber`. The failure is a decode error, never a silent value |
| `serde_json::Number` and `Value` equality compare text (`1.0` differs from `1`) | never compare serde_json values for JavaScript semantics; compare `JsonValue` |
| `jsonschema` compares numbers exactly (integers above 2^53, and decimals as exact fractions), where Ajv compared `f64`; bounds agree when the number is written from its `f64`, `multipleOf` does not (`0.3` and `0.1`) | every number goes through its `f64` before jsonschema: one shared conversion of `JsonValue` to `serde_json::Value` in `seampact-ir-check` writes each number from `to_f64`, for the validate stage, the draft check and the manifest. Ajv's results hold, with no `differences.yaml` entry. A test keeps the `multipleOf` keyword out of the bundled schemas (the IR member of that name is data, not the keyword) |
| a `serde_json::Value` or `Number` written by a non-serde_json serializer (YAML, TOML, CBOR) becomes a private-struct map `{"$serde_json::private::Number": "1"}`, silently | never hand a serde_json value, or a type whose `Serialize` writes one (`JsonValue`, the IR types), to another format; the YAML emitter takes `JsonValue` |
| `Number::as_f64` parses text on each call | not measurable in the spike; convert once into `JsonNumber` |

A TypeScript pass that copies an authoring number into an IR integer member converts it with the shared JS-integer helper of section 2 (`Number.isInteger` per PORTING section 2, then the safe range). It fails as a `Result`; it never rounds. There is no draft-level number type: the helper's `Err` becomes the internal diagnostic naming the IR member, the same outcome as today, where a non-integer in an IR integer member fails finalize's strict check as an internal error (`packages/core/compiler/src/finalize/validate.ts`).

## 4. Threads and strings

- Every IR and authoring type is plain owned data (`String`, `Vec`, `Box`, `IndexMap`), so it is `Send + Sync` without an `unsafe impl`. Each crate asserts it at compile time for its root types (`ContractIr`, `SourceMap`, `RawWorkspace`).
- Generators run per family with `rayon` over a shared `&ContractIr`. A shared borrow is enough, so no `Arc` appears in the types. The driver may hold an `Arc<ContractIr>` only where a thread outlives the borrow, outside the types.
- No `Rc`, `RefCell` or `Cell` in these types. An engine's memo state stays outside the data (PORTING section 1, "State").
- Strings are owned `String`, ids too. `Arc<str>` buys nothing when sharing is by borrow. Borrowed `&'src str` would put a lifetime on every pass and generator signature and tie the IR to the source buffers, which a watch mode drops. The IR is built once, so clones are cheap next to compile time.
- No global interner (PORTING section 9 avoids `internment` and `ustr`). If profiling ever shows a hot spot, a per-run `IndexSet<Box<str>>` is the fallback, behind the same newtypes.

## 5. Ownership across the pass halves

- Each half (`tree.schemas`, `tree.nodes`, `access.identity`, `access.rights`, `derive.wire`, `derive.errors`) returns an owned output holding only the fields ADR 0006 section 3 gives it. Later halves take the earlier outputs by shared reference. No half can write outside its ownership, because it holds no `&mut` to another half's data.
- The outputs are built from the IR types (an `Operation`'s `params` are `Vec<Parameter>`, a declaration is `ErrorDecl`). Finalize then moves the parts into `ContractIr` and `Operation` without copying.
- Shared fields keep their ADR 0006 modes. An `elements` list is one `Vec` per half, concatenated in run order. A `default` member is an `Option` per half listed, and the first `Some` in run order wins. That matches ADR 0006's `default` mode only if no later half reads whether the value is set; the pipeline design note confirms it.
- A half that reads "the draft" reads a view struct of references to the earlier outputs (`DraftView<'run>`), built by the pipeline. Its design belongs to the pipeline note.
- The per-half dumps of the oracle are each half's output serialized. The oracle compares them as JSON values, members by name (`scripts/oracle/README.md`). TypeScript writes them in insertion order, and the spike found 990 of 1,032 halves files whose bytes differ from the canonical text, so only their values are held, never their bytes.

## 6. Writing IR JSON

- The canonical writer owns the IR bytes. It writes a `JsonValue`: every object's members sorted by `cmp_utf16`, two-space indent, LF, a final newline, strings escaped as `JSON.stringify` escapes them, numbers through `JsonNumber`'s `Display` (the `seampact-js` number-text helper, `1e+21`, `-0` written `0`). The same writer writes the source map.
- `Serialize` on the IR types only builds the value (`ContractIr` to `serde_json::Value` to `JsonValue`, or a direct serializer if the writer seam prefers one). The order of struct fields has no effect on the IR bytes, so the derive never has to match the writer's order.
- The in-memory order of IR maps follows the TypeScript consumers. The CLI hands generators the IR parsed back from its canonical text (`finalizeCanonicalIr`), where array-index keys (`"0"`, `"200"`) come first in ascending order and the rest in UTF-16 order. JavaScript keeps array-index keys first on every insert, not only on parse, for a draft map and a merged tree alike, and rights and principal variants take any name. So the IR map type (`IrMap<K, V>`, in `seampact-ir`) and `JsonObject` (in `seampact-json`) are newtypes over `IndexMap` whose `insert` keeps JavaScript's own-key order (`js_key_order`). Finalize and every reader of IR JSON then sort each IR map by `cmp_utf16` behind the array-index keys. A generator iterating an IR map then sees what a TypeScript generator saw, and no port has to remember the rule.
- A lone surrogate cannot reach a Rust `String`. How the loader treats a lone-surrogate escape is for the loader note; the writer never meets one.
- The strict validation of finalize runs `jsonschema` on the IR converted through the shared validation conversion of section 3, so every number is checked as its `f64`, as Ajv checked it.

## 7. Authoring types

The TypeScript loader hands over JSON trees, not typed mappings: `RawWorkspace`, `RawApi` with its layers, the merged tree, `leafOrigins` and the `locations` table (`packages/core/compiler/src/raw-tree.ts`). The passes read members with `typeof` checks. Rust keeps that shape and adds typed readers. A typed struct per mapping (25 authoring schemas) would change the function shape the port keeps, and the POC showed where strict typed facades fail: a member of an unexpected type broke the decode of the whole input.

- **The tree.** A loaded file is a `JsonValue` whose objects are `JsonObject`, whose `insert` keeps JavaScript's own-key order (section 6): insertion order with array-index keys moved first. The loader and every merge build objects through it, so a pass then iterates a `responses` mapping keyed `"200"` and `"404"` as the TypeScript did, without remembering a rule. Numbers are `JsonNumber`, so a contract integer above 2^53 keeps its digits from YAML to the IR.
- **What the loader hands over.** `RawWorkspace { root, apis: Vec<RawApi>, locations, entry: Option<RawEntryLayer>, config: Option<RawWorkspaceConfig> }` (the loader's own read of `editorSchemas` and `imports`) and `RawApi { name, layers: Vec<RawLayer>, merged: JsonObject, leaf_origins: IndexMap<String, Origin>, locations, visibility }`, with the same members as `raw-tree.ts`. `leaf_origins` is keyed by `String` because `ir::Origin.pointer` is a `String` held to the IR schema; a `JsonPointer` newtype lands in `seampact-json` together with `Origin.pointer`, in one IR seam change, once a pass port shows pointers mixed up with location keys. `RawLayer.layer` is an `ApiLayer` enum (`Api`, `Shared`, `Base`, `Pack(PackName)`), which converts into `ir::Layer` and cannot be `Core` or `Workspace`.
- **Spans.** Positions stay in the side table, keyed by `"<layer>#<pointer>"` as in the TypeScript, built only by `seampact_span::location_key`, never inline in the tree. Each entry holds a span from the spans seam: a file id and a byte range. Diagnostics and the source map turn a span into a line and a UTF-16 column at the edge (PORTING section 2). A pass reports an origin (layer and pointer), as it does now.
- **Typed reading.** Each reader returns an `Option`, and a member of the wrong type reads as absent where the TypeScript read `undefined` (PORTING section 1, "Typed input"). There is no decode failure of the whole input:

```rust
impl JsonObjectExt for JsonObject {
    fn member(&self, key: &str) -> Option<&JsonValue>;          // own key only; any type
    fn string(&self, key: &str) -> Option<&str>;                // typeof === "string"
    fn number(&self, key: &str) -> Option<&JsonNumber>;         // typeof === "number"; to_f64 for comparisons
    fn boolean(&self, key: &str) -> Option<bool>;
    fn object(&self, key: &str) -> Option<&JsonObject>;         // a non-null, non-array object
    fn array(&self, key: &str) -> Option<&[JsonValue]>;
}
```

- A pass port calls the reader that matches the TypeScript check, and keeps the TypeScript's own diagnostic when it reported a wrong type. A value the TypeScript passed on without a check (a data position, an extension value) is taken as `&JsonValue` and cloned into the IR.
- **Grammar data.** The authoring schemas are the committed `packages/core/spec/schemas/authoring/*.schema.json`, embedded with `include_str!`. The TypeScript builders in `packages/core/spec/src/authoring/` stay their source while the TypeScript lives. `MARKERS`, `DATA`, `RESERVED_NAMES` and the schema keyword table port as Rust constants, each with a test against the embedded schemas.

## 8. Holding the types to the schemas

Three tests in `seampact-ir`, all reading the schema files and fixtures from the repository (never inline copies):

1. **Round trip, byte-identical.** Every `fixtures/expected/**/ir/*.json` and `source-map/*.json` decodes into the typed root (`ContractIr` or `SourceMap`) and goes back through the canonical writer. The test compares bytes with the file and reports the first differing JSON pointer. The schema examples (`packages/core/spec/schemas/ir/examples/*.json`) are hand-written, not writer output: they are compared by value, and their canonical text must be stable. `every-member.ir.json` names every member of the 668 schema properties, and `unknown-kind.ir.json` and `unknown-enum-value.ir.json` cover the unknown arms, which write back what they read. `unknown-member.ir.json` must differ by exactly its unknown member, which readers drop. A member the Rust type lacks is dropped on decode, so the bytes differ. The spike's first run caught exactly that: a missing `derivedFrom` on `UnknownKeys`.
2. **Schema walk.** For each definition of the schema files:
   - an open enum or union matches its registry entry (section 2), in both directions: definition name, tag member, known values or tags, must-act flag;
   - every property of every object definition appears at least once in `every-member.ir.json`, found by the instance walk, so test 1 covers it;
   - an object definition's `required` list matches the types: the test removes each member of `every-member.ir.json` once. The typed decode must fail when the member is required and succeed when it is optional.
3. **Integer members.** For each integer definition, the `every-member.ir.json` value decoded at the definition's `minimum`, at its `maximum`, and in float form (`404.0`) gives the same `i64`. It catches a type narrower than the schema (`u16` for a `0..2^53-1` member) and a member decoded without the shared deserializer, which the round trip on fixture integer text does not.

What fails when a schema changes, in the same PR: a new member fails the coverage check until `every-member.ir.json` carries it, then test 1 until the Rust type has it. A member that changes between required and optional fails the `required` check. A new known value, tag or definition fails the registry check, naming the definition. The TypeScript types test regenerates its types from the same files, so the two languages fail together.

## 9. Out of scope

- The diagnostic type and the span types: the spans and diagnostics seam.
- The loader internals: YAML events, plain-scalar resolution (including which literals become exact integers and how `+1` or `0x10` read), lone-surrogate escapes, limits, file reading. The loader design note fixes them within section 7.
- The canonical writer internals: escaping details, buffer strategy, whether it consumes a `serde_json::Value` or its own serializer. The writer seam fixes them within section 6.
- The pass-half output types and the draft view: the pipeline note, within section 5.
- The ports of the reader helpers (support check, closed check, invariants): later lanes, in `seampact-ir`; the validator in `seampact-ir-check`.

## Spike evidence

A throwaway workspace (`serde_json` 1.0.154, `jsonschema` 0.61.1, `ryu-js` 1.0.3), run once without and once with `arbitrary_precision`, with identical results except for the wide integers:

| Check | Result |
|---|---|
| Every expected `ir/` and `source-map/` file (178): parse, canonical writer, compare bytes | 178 identical, 0.18 s (release) |
| Typed round trip of `errors`, `natures`, `conventions` (89 IRs) and of every type use found (4,593: 3,422 scalar, 517 enum, 472 ref, 171 array, 10 opaque, 1 file) | all identical once `UnknownKeys.derivedFrom` was added |
| `jsonschema` on the 89 expected IRs with the IR schema files | all valid; build 7 ms, 89 files in 0.10 s |
| `big-integers/above-2-pow-53` (`9223372036854776000`, the TypeScript's rounding) | read as an exact integer, written back unchanged |
| Integers wider than 64 bits through JSON | exact with the feature; `1e+29` and `-9223372036854776000` without |
| `#[serde(tag)]` derive under the feature | `i64` members decode; an `f64` member fails |
| A present `null` in an optional opaque member | `Some(JsonValue::Null)` with `present`; `None` without it |
