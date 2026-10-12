# IR change changeset template

Copy into `.changeset/<branch>.md` for every IR change PR (ADR 0005 section 1). The PR raises `IR_REVISION` in `packages/spec/src/ir/version.ts` by one, regenerates the TypeScript types, the golden IR files and the Kotlin and PHP models, and merges before any work that needs it.

```md
---
"@seampact/spec": minor
---

<One sentence: what the IR gains or loses.>

## IR change

- irRevision: <old> to <new>
- Classification: additive | tightening | breaking (ADR 0005 section 4; tightening: a reader of the new revision refuses IR an older compiler could write)

| Field or kind | Schema path | Change | Additive, tightening or breaking | Guarded by |
|---|---|---|---|---|
| `<member>` | `<file>.schema.json#/$defs/<Def>/properties/<member>` | added, removed, renamed, type changed, enum value added, must-act added | additive | `<feature or kind name>`, or none |

### What a target must do

- <Read the new member, or nothing: readers ignore unknown members.>
- <Support the new feature or kind name, or refuse it by name.>
- <For a breaking change: what to rewrite, and the irVersion it reads.>
```

Rules the reviewer checks:

- A new member whose absence makes an older reader generate a weaker check comes with a feature or kind name in the same PR; without one it is not allowed.
- A new tag or value on a must-act union or enum (`"x-seampact-must-act": true`, README.md) always names its feature in the "Guarded by" column; must-act is never removed from a definition.
- Adding must-act to an existing definition is a tightening, and names its feature in the "Guarded by" column.
- A new invariant (README.md, `checkIrInvariants`) is a tightening; relaxing or removing one is breaking.
- A new known value of a struct's deciding member (`ValueSource.in`, `FieldWire.kind`, `TypeUse.kind`, `HeaderDecl.semantic`, `Cache.family`'s `never`) updates that struct's invariant and its partition in `invariants.ts`; the partition test fails until it does.
- Definition names are the generated model type names (README.md): renaming a definition or a union variant, turning a struct into a tagged union or a union into a struct, and adding a required member are breaking.
- A convention a target acts on is a typed member, never a value read from `conventions` (ADR 0004 section 13).
- A new value of an open enum is additive; removing or renaming a member, kind or value, changing a type, unit or meaning, making an optional member required, or changing canonical ordering, ids or serialisation is breaking.
- A new key in an extension slot is not an IR change.
