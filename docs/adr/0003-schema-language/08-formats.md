### 8. Formats

The closed set (FR-3):

| `format` | On | Wire form | Meaning |
|---|---|---|---|
| `uuid` | string | `8-4-4-4-12` hex digits | RFC 9562 UUID text, either case on input, lowercase on emit |
| `date-time` | string | RFC 3339 with a time offset | an instant; a value without an offset is refused |
| `date` | string | RFC 3339 `full-date` | a calendar date |
| `int64` | integer | a JSON string of decimal digits by default | a 64-bit signed integer. By default a string on the wire in every target, so no JavaScript reader loses precision; `conventions.int64: number` sends a JSON number instead (A36), and a client target that cannot read it exactly fails `generate` (FR-14). Targets type it as their 64-bit integer, or as a string where none exists |
| `decimal` | string | `-?(0\|[1-9][0-9]*)(\.[0-9]+)?` | an exact decimal; range refinements compare numerically and targets use their decimal type |
| `email` | string | a WHATWG HTML "valid e-mail address" | an address a form would accept: no display name, no quoted local part, no IP literal |
| `uri` | string | an RFC 3986 `URI` | an absolute URI: a scheme, then the rest (`https://example.com/a?b#c`) |
| `uri-reference` | string | an RFC 3986 `URI-reference` | a URI or a relative reference (`/tasks/1`, `../a`), as a `Location` header may hold |
| a named format | string, integer | per its declaration | declared by a pack or base, below |

`email`, `uri` and `uri-reference` are checked with the patterns `@seampact/spec` publishes in its format table, through the normalised regular expressions of section 9, never with a library's own check: zod's `email()`, Bean Validation's `@Email` and Laravel's `email` rule each accept a different set. The shared payload table holds their boundary cases (a missing scheme, a space, a non-ASCII character, an empty string).

A plain `integer` without format is a JSON number in the safe range of an IEEE double (from -(2^53 - 1) to 2^53 - 1); a larger value needs `int64`. On input, an integer accepts any JSON number whose value is whole (`1.0` and `1e2` read as 1 and 100, since a JavaScript decoder cannot tell them from `1` and `100`, and a PHP decoder gives a float for them) and refuses a fraction; every target accepts a whole float, and a target whose decoder truncates (Jackson's float-to-int coercion) or whose rule wants a true integer type (Laravel's `integer:strict`) checks the value is whole first. `password` is not authorable: it is what `sensitive` emits.

`date-time` follows RFC 3339 `date-time`: on input, `T` and `Z` in either case, a fraction of 1 to 9 digits, any offset; a leap second (`:60`) is refused, because most target libraries refuse it. On emit, `T` and `Z` are uppercase and the fraction is written as the value holds it, without trailing zeros. Native date types hold different precisions (a JavaScript `Date` milliseconds, PHP's `DateTimeImmutable` microseconds, `java.time` nanoseconds), so a target whose native type holds fewer than nine fraction digits types a `date-time` as a string (TypeScript), or keeps it native and documents the precision it keeps; the payload table holds a nine-digit fraction case.

`int64` and `decimal` are strings, so JSON Schema's numeric keywords cannot carry their refinements. The OpenAPI emitter writes them as `type: string` with the format and its pattern (`^-?(0|[1-9][0-9]*)$` for `int64`, the wire form above for `decimal`), and the numeric refinements as `x-seampact-minimum`, `x-seampact-maximum`, `x-seampact-exclusiveMinimum`, `x-seampact-exclusiveMaximum` and `x-seampact-multipleOf`; every target checks them numerically.

Named formats (`money`, `countryCode` and the like) are declared in a `scalars` catalogue, which this ADR adds to the catalogues of ADR 0002 section 1. A named format is a base type plus refinements, so every target can check it with the portable keywords alone, and a target may map it to a native type through its options:

```yaml
# packs/house.yaml (excerpt)
scalars:
  money:
    type: string
    pattern: '^-?(0|[1-9][0-9]*)\.[0-9]{2}$'
    description: An amount with two decimals, in the currency of its context.
  countryCode:
    type: string
    pattern: '^[A-Z]{2}$'
```

A field then writes `{ format: money }`: its type is the scalar's, and writing `type` beside a named format is refused, since the scalar already states it. The portable formats above keep JSON Schema's spelling, `type` with `format`, so `{ format: email }` without `type` is refused. A scalar may not take the name of a portable format (`uuid`, `date-time`, `date`, `int64`, `decimal`, `email`, `uri`, `uri-reference`) or `password`: one name would then mean two checks. Both errors name the portable spelling as the fix (`type: string, format: email`).
