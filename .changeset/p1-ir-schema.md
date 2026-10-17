---
"@seampact/spec": minor
---

Publish the IR JSON Schema (irVersion 1, irRevision 1), its generated TypeScript types, `createIrValidator` with the open and strict forms, `listIrUnknowns`, `isKnownVariant`, `checkIrSupport` and `checkIrInvariants`.

## IR change

- irRevision: none to 1 (the seam: the IR becomes change-controlled at M1)
- Classification: additive (first publication)

| Field or kind | Schema path | Change | Additive or breaking | Guarded by |
|---|---|---|---|---|
| every member of ADR 0004 sections 2 to 8 and 11 | `packages/core/spec/schemas/ir/*.schema.json` | added | additive | kind `httpOperation`; no feature |

### What a target must do

- Declare `irVersions: [1]`, `irRevision: 1`, `kinds: ["httpOperation"]` and `features: []`, and call `checkIrSupport` before reading.
- Ignore unknown members; refuse by name an unknown open-enum value or union tag it must act on. An unknown tag or value on a must-act definition (`x-seampact-must-act`) makes the IR invalid for every reader.
- Read IR maps with `Object.hasOwn`; read numeric refinements as decimal literal strings.
