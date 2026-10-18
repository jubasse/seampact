---
"@seampact/compiler": minor
---

The compiler orders a workspace's apis by their relay routes, refuses a relay cycle with `seampact/workspace/relay-cycle`, and finalizes each api into a validated, canonically ordered IR with byte-stable text (`finalizeSerializeIr`) and its source-location side table.

Finalize drops every declaration no operation, identity or convention reaches, and refuses an error code, a body-proof input name, a schema, an enum or a named format that would share a `components.schemas` key with another, with `seampact/finalize/id-collision`.

Every array the IR format sorts is sorted, among them identity errors and headers, error roles, cache per-caller rules and lint allows, with ties broken by the element's bytes.
