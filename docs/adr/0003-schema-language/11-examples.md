### 11. Examples

`examples` on a schema is a list of values, each parsed against the schema at compile time with the strict input rules (unknown keys refused), so an example is never looser than a request (FR-3, SCN-006, CHK-053). Named examples on routes are ADR 0002 section 12; an error's example is its params. A schema example describes the payload and reaches OpenAPI unchanged; a route example is also the payload the handler returns (the item, the item array of a list, the id-keyed table), and the emitter wraps it through the operation's format and paging style before writing it (A30).
