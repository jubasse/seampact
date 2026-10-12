# IR change changeset template

Copy into `.changeset/<branch>.md` for every IR change PR (ADR 0005 section 1). The PR raises `IR_REVISION` in `packages/spec/src/ir/version.ts` by one, regenerates the TypeScript types, the golden IR files and the Kotlin and PHP models, and merges before any work that needs it.

```md
---
"@seampact/spec": minor
---

<One sentence: what the IR gains or loses.>

## IR change

- irRevision: <old> to <new>
- Classification: additive | breaking (ADR 0005 section 4)

| Field or kind | Schema path | Change | Additive or breaking | Guarded by |
|---|---|---|---|---|
| `<member>` | `<file>.schema.json#/$defs/<Def>/properties/<member>` | added, removed, renamed, type changed, enum value added | additive | `<feature or kind name>`, or none |

### What a target must do

- <Read the new member, or nothing: readers ignore unknown members.>
- <Support the new feature or kind name, or refuse it by name.>
- <For a breaking change: what to rewrite, and the irVersion it reads.>
```

Rules the reviewer checks:

- A new member whose absence makes an older reader generate a weaker check comes with a feature or kind name in the same PR; without one it is not allowed.
- A new value of an open enum is additive; removing or renaming a member, kind or value, changing a type, unit or meaning, making an optional member required, or changing canonical ordering, ids or serialisation is breaking.
- A new key in an extension slot is not an IR change.
