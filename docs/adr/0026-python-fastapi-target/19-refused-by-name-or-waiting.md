### Refused by name or waiting

`generate` refuses by name, with its code and fix, every input the target does not serve ([A47](../../decisions.md#a47)). It reads only the operations the entry's `operations` filter keeps (ADR 0011).

| Waits for | What |
|---|---|
| a consumer that needs them | form, multipart, download and redirect bodies; native access (`artefacts.accessHooks: false`); sort keys restricted by a right; unions (`oneOf`); `handlers: perOperation`; per-access-kind dependency lists |
| after 1.0 | FastAPI minors below the floor and Pydantic 1 (refused, not waiting); `hooks: vendored` ([A40](../../decisions.md#a40)); principal bindings, refused by name as on PHP; every IR form absent from the reference contract's golden IRs, as ADR 0023 lists them |
