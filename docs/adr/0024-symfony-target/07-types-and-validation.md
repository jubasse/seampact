### Types and validation

Generated value types are ADR 0023's:

- `final readonly` classes for objects;
- an abstract base class with one final class per variant for unions, with an `Unknown` variant only on input readers;
- backed enums;
- `?T` for an optional or a nullable member, and `seampact/hooks`'s `Field` for a member both optional and nullable (CHK-158);
- `DateTimeImmutable` for a `date-time`, kept with its offset;
- integers as `int` in the IR's safe range, checked as whole numbers, so `1.0` is an integer; a JSON integer above 2^53 - 1 in magnitude is refused as `maximum`, or `minimum` below zero, whether it decodes to an `int` or a float, as on the Node targets (ADR 0003).

Wire names that differ from the PHP property name are carried by the generated decoder and encoder; no Serializer attribute is needed.

The boundary decodes the held body with `json_decode($bytes, false, 512, JSON_THROW_ON_ERROR)`, objects preserved: a body that does not decode as UTF-8 JSON, or nests deeper than 512, is the malformed 400 of step 1. So is a valid body with an object key that starts with a NUL byte (`{"\u0000a":1}`), which PHP cannot hold as a property name, a parity gap listed in Consequences. Path, query and headers are decoded by the IR's wire form. The `kernel.controller` listener then runs:

1. **The fail-closed checks**, before any hook or input is read. The listener reads the operation from three places: the attribute on the controller's method (`ControllerEvent::getAttributes()`), the chosen route's `_seampact_operation` default, and step 1's raw-path match.
   - An attribute without a contract route (an app route to a contract action, spike) or a contract route whose controller method lacks the attribute throws the boundary's internal exception: the api's 500 with `onUnexpectedError` called.
   - A contract route whose operation differs from the raw-path match answers that path's `notFound` 404 (spike).
   - The value resolver returns only an input the listener stored for that operation. A request that never passed the listener (a sub-request from `forward()` or `render(controller())`, a test that calls the method directly) throws the internal exception. The Symfony guide says so for functional tests.
2. **Steps 2 to 5**: authenticate, principal requirements, scopes and requirements, with the hooks of "Options and registration".
3. **Step 6**: the operation's generated constraint, run through the app's `validator` service on the decoded tree. Per member:
   - it reads presence with `property_exists` or `array_key_exists`, so an explicit `null` and an absent key never look alike, and a required member is present;
   - it checks the member's type on the objects-preserved tree (no coercion, `{}` versus `[]`, whole numbers);
   - only when the type passes, it runs the member's value constraints at that member's path, as `Sequentially` does, so a type issue is the member's only issue.

   Unknown keys, `enum`, `const`, `oneOf`, the discriminator and `uniqueItems` are generated constraints: Symfony's `Choice` compares with `===` and refuses `1.0` for an integer `1`, and `Unique` passes `[1, 1.0]` (spike). A nullable member needs no extra constraint, since every Symfony value constraint passes `null` (spike), and a `null` on a member that is not nullable fails the type check first. The body is decoded without `JSON_BIGINT_AS_STRING`, which would turn a large JSON number into the same string as a JSON string, so a JSON integer beyond the `int` range decodes to a float: it is a type issue on a string member, including an `int64` or `decimal` member carried as a string, and read as a float on a `number` member. On an `integer` member, the type check accepts a float (`is_float()`) only when it is whole and its magnitude is at most 2^53, such as `1.0`: a whole float whose magnitude is at least 2^63 (so -2^63 too, since `-9223372036854775809` decodes to a float equal to `PHP_INT_MIN`) is 400 `maximum`, or `minimum` below zero, as on the JVM and Laravel, and a whole float of smaller magnitude above 2^53 is refused the same way, since its value may have changed in the decode; a JSON integer that fits an `int` decodes to an `int` and is never a float.

   Each violation carries its contract rule name in the constraint's `payload`, read back with `getConstraint()` (spike), so each issue is `{ in, pointer, rule }`; Symfony's message is never rendered or logged, since it can quote the value. The issues are bounded by `MAX_RENDERED_ISSUES = 100`. A failure throws the generated `schemaInvalid` exception: the 400, never a 422.
4. **Steps 7 and 8**, then the typed input, stored in a request attribute under a generated name for the value resolver.

The target takes `rules` (ADR 0009), as the Laravel target does:

- **`native`, the default.** A value rule renders as Symfony's own constraint wherever Symfony has one: `Length` on strings (counted in code points, as the contract counts, spike), `Count` on arrays, one comparison constraint per bound on members carried as JSON numbers (`GreaterThanOrEqual`, `LessThanOrEqual`, `GreaterThan`, `LessThan`, never `Range`, so each violation carries its own rule), `DivisibleBy` for `multipleOf`, and `Regex` (with the `u` modifier; a search, spike). The `uuid` format stays generated in both modes: Symfony's `Uuid` refuses RFC 9562 text that ADR 0003 accepts (the nil and max UUIDs, version digits outside 1 to 8, variant digits outside 8 to b), and a native constraint that raises several violations for one rule gives one issue. `multipleOf` is the exact integer step that ADR 0003 keeps on `integer` (`2.5` gives 5, as on the Node targets); a step on a `number` is refused as an inconsistent IR, and a step beyond the PHP `int` range waits for a consumer after 1.0. A format other than `uuid` and `date-time` is refused by name (`format.string.unsupported`), as the shared form walk refuses it for Laravel, and `int64` and `decimal` wait for a consumer after 1.0 (`format.wide.unsupported`): a number constraint would compare their decimal text as a float (`Range` passed `"9223372036854775808"` under a `PHP_INT_MAX` maximum, spike). `date-time`, which Symfony has no constraint for, stays generated. The Symfony guide lists the differences in a few lines (`Regex` on PCRE).
- **`seampact-consistent`.** Every value rule is a generated constraint with ADR 0003's meaning, patterns searched as ECMA-262 does through the normalised pattern of ADR 0003 section 9, rendered for PCRE with the `u` and `D` modifiers.

`Regex` passes an empty string without checking it, as `Email`, `Url`, `Uuid` and `Ip` do, while `Length` checks it and counts whitespace (spike). Under `native`, a string member with a pattern therefore also gets a generated check that applies the pattern to `""`, so an empty string never passes a `pattern` unchecked; a string of spaces reaches `Regex`, which checks it.

The contract input is the boundary's decoding. `$request->getContent()`, `getPayload()` and `toArray()` keep their Symfony meaning for app code: `getContent()` returns the bytes as received after the boundary's streamed read (spike), and the compressed bytes for a `gzip` or `deflate` body.

The body's top level also takes the proof fields of its rules, which the access steps check, so `unknownKeys` does not refuse them (`purgeTask`'s `reauthToken`). Header issues point at the header's name in lower case, as on the other targets. Opaque values accept `null` only when nullable (ADR 0003 section 2) and refuse a non-finite number anywhere inside them as `type`, as on the Laravel target.
