---
"@seampact/compiler": patch
"@seampact/spec": patch
---

Close the load stage: typed scalars (P6) and data positions read from the authoring schemas, the workspace entry file validated like every other file, and the loader's trust model written down (ADR 0006 section 1).

- A quoted whole number where a string or an integer goes (`version: '1'`) is refused as P6; a scalar P1 to P4 already refuse gets no second report.
- The authoring schemas mark their data positions with the title `data` (`DATA`): an example's `value`, an error's `example`, a schema's `default` and its `examples` items. Only those are data; an extension value is not.
- A pack name holding `#` is refused (`seampact/load/pack-name`).
- An entry file whose `$include` brings `workspace:` is a workspace file; an entry that is both a workspace and an api is refused (`seampact/load/workspace-shape`).
- `entryLocationKey(pointer)` spells the key of a workspace entry pointer in `RawWorkspace.locations`; `schemaKindOf(layer)` names the authoring schema a layer is read and validated as.
