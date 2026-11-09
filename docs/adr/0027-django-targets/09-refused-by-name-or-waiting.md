### Refused by name or waiting

`generate` refuses by name, with its code and fix, every input the targets do not serve ([A47](../../decisions.md#a47)), as ADR 0026 lists them.

| Waits for | What |
|---|---|
| a consumer that needs them | ADR 0026's list; `async def` hooks and handlers on DRF and in Ninja's sync views |
| after 1.0 | Django, DRF and Ninja versions below the floor (refused, not waiting); `hooks: vendored` ([A40](../../decisions.md#a40)); principal bindings, refused by name as on PHP |
