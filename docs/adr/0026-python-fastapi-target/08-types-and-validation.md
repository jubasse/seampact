### Types and validation

A rule's proof members in the body (ADR 0012 requirements) are read by the access steps from the decoded body and handed to the rule's decider; the typed body the handler reads leaves them out. The access steps check only a scalar proof's type, `uuid` format and length, as PHP's do; step 6 then validates every proof by its full type with `<Op>Proofs`, a model of the schemas module that the handler never reads, and reports its issues at the proof's body member.

Generated value types:

- Pydantic models for objects, with `ConfigDict(strict=True, protected_namespaces=())` and `extra` set by the object's unknown-key rule;
- a discriminated union of one model per variant for unions, with an `Unknown` variant only on input readers;
- `StrEnum` classes for enums;
- `T | None` for an optional or a nullable member (an optional member that is not nullable still refuses a wire `null`, ADR 0003 section 5), and `Field[T]` for a member both optional and nullable; presence is read from `model_fields_set` (spike);
- `datetime` for a `date-time`, kept with the offset it was sent with;
- `int` in the IR's safe range for integers, checked as whole numbers, so `1.0` is an integer (ADR 0003 Consequences).

The boundary decodes the held body with Python's `json` module into a tree that keeps objects and arrays apart. Path, query and headers are decoded by the IR's wire form. The input dependency then validates the tree with the operation's model, `model_validate(tree, strict=True)`. The generated type layer runs first, as annotated types whose `BeforeValidator` Pydantic runs before its strict check:

- a whole-number float in the safe range becomes an `int`; `1.5`, `true` and `"1"` stay refused (spike);
- a string carried on the wire for a `date-time`, a `date`, a `uuid`, a `decimal` or an enum member is parsed by the contract's rule, since strict mode refuses those strings on Python objects (spike);
- `{}` and `[]` stay apart: strict mode refuses an object for a list and a list for an object (spike).

FastAPI's own parameter parsing never runs on a contract route: the endpoint declares no parameter FastAPI parses, so FastAPI answers no 422 (spike). A refused input throws the generated `schemaInvalid` exception, so the 400 is rendered. Each issue carries its `{ in, pointer, rule }`, the contract rule name kept per Pydantic error type, bounded by `MAX_RENDERED_ISSUES = 100`.

The target takes `rules` (ADR 0009):

- **`native`, the default.** A value rule renders as Pydantic's own constraint wherever Pydantic has one: `min_length` and `max_length` (counted in code points, as the contract counts), `ge`, `gt`, `le`, `lt`, `multiple_of`, `pattern`. `enum` and `const` stay generated. A format Pydantic has no matching rule for stays a generated validator. The FastAPI guide lists the differences in a few lines.
- **`seampact-consistent`.** Every value rule is a generated validator with ADR 0003's meaning.

In both modes a `pattern` is the IR's normalised pattern (ADR 0003 section 9), checked by Pydantic's Rust engine; the generated models pin `regex_engine="rust-regex"`. Every normalised pattern of the golden IRs compiles there and gives the contract's verdicts, `$` before a final newline and `.` on an astral code point included (spike). The written pattern is never used: Rust's `\d` and `\w` are Unicode. The compiler already refuses lookaround and backreferences, which Rust refuses too, when the model class is built. So patterns give the same verdicts as on the other targets, and the FastAPI guide lists no pattern difference.

The contract input is the boundary's decoding, never `await request.json()` or `request.query_params`. The boundary replays the body bytes as received to the app through the wrapped `receive`, so app code that reads `await request.body()` sees them.
