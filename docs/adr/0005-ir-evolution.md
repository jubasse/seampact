# ADR 0005: IR evolution

Status: accepted

## Context

The IR is a public API. Up to sixteen targets in three languages, two generated native models (FR-40), the OpenAPI emitter, lint and diff read it, and generators written outside the repository will too. The first plan froze `irVersion: 1` at the end of phase 1 (the loader and the authoring and IR schemas); the framing replaced that with a two-step freeze (FR-37) because the compiler passes of phase 2 (the semantic compiler) will find gaps in an IR schema written before them. [A8](../decisions.md#a8) sets the policy from 1.0: semver, an additive change keeps `irVersion`, a removal or change of meaning bumps `irVersion` and the major version, and each target declares the `irVersion` range it reads.

This ADR decides how the IR changes before and after 1.0, what counts as additive, and how readers protect themselves.

## Options

1. Freeze `irVersion: 1` at the end of phase 1 and treat any later change as a new version.
2. No freeze before 1.0; change the IR freely and fix targets as they break.
3. A two-step freeze with an exact revision counter before 1.0, semver after, and an IR that is additive by design.

Option 1 forces either an `irVersion` bump during phase 2 (while every pass is still learning the shape) or workarounds that keep a wrong shape forever. Option 2 makes every target chase a moving seam, the main risk of building targets in parallel. Option 3 is chosen (FR-37).

## Decision

### 1. Two steps

**Change-controlled, from the end of phase 1.** The IR JSON Schema and its TypeScript types merge as the seam of phase 2. From then on:

- each IR change is its own small PR, merged before any work that needs it;
- the PR raises `irRevision` by one, regenerates the golden IR files, regenerates the Kotlin and PHP models (FR-40, SCN-095), and carries a release note: a changeset on `@seampact/spec` with an "IR change" section naming each field or kind, whether it is additive, and what a target must do;
- work that needs an IR change asks for that change PR; it never edits the IR schema in its own PR.

**Frozen for targets, at the end of phase 2.** The gate is met when the golden IR of the reference contract (ADR 0002), a signed webhook, a tenant-scoped route with rights and a service api with relays all compile, and a TypeScript reader, a Kotlin reader and a PHP reader have each been written against it and reviewed. No target work starts before this gate. After it, the IR still changes only through the change-controlled PRs above, and each change is additive unless the maintainers accept a breaking one with its release note (A8 allows it before 1.0).

### 2. Versions

- `irVersion` is an integer. It is `1` until 1.0 and through 1.x.
- `irRevision` is an integer that rises by one with every IR change, additive or not, from the merge of the seam on.
- Before 1.0, a target reads exactly one `irRevision`, the one it was built for. A different revision fails `generate`, naming both revisions and the package to update (SCN-091, CHK-077). Exact matching is cheap while nothing is published ([A3](../decisions.md#a3)) and every target lives in the monorepo.
- From 1.0 (A8), the IR is under semver with `@seampact/spec`: an additive change keeps `irVersion` and is a minor version of the spec; a removal or a change of meaning bumps `irVersion` and the major version. `irRevision` keeps rising as a record of changes but no reader checks it exactly any more.
- Every target declares the `irVersion` values it reads (`irVersions: [1]`), and before 1.0 its `irRevision`. The CLI checks both before calling a TypeScript target (ADR 0009); the Kotlin and PHP models check them on read (ADR 0010). An IR outside the declared range fails with both values named, and no file is written (SCN-052).

### 3. Additive by design

Three properties let most changes be additive (FR-37, SCN-092, CHK-078):

1. **Readers ignore unknown members.** A target, model, emitter or lint rule ignores an object member it does not know, and generates identical files when one is added. The generated Kotlin and PHP models are built to keep unknown members, not reject them.
2. **Every IR enum is open.** A string member with a set of known values (`kind`, `method`, `nature`, `semantic`, `shape`, a paging style's `position` and roles, and every other) is typed in the IR JSON Schema as a string with its known values listed, never as a closed `enum`. A reader that must act on the value and meets an unknown one fails with a diagnostic naming the value, the member and the operation; it never guesses and never silently skips.
3. **Every extendable object has an extension slot.** Api, operation, schema, property, right, rule and scope carry `extensions` (ADR 0004), so consumer data and later experiments never need a new core member.

One more rule closes the gap the first property opens: a reader that ignores a new member must still generate code that is correct, even if less complete. A new member whose absence would make an older reader generate a weaker check ([lesson 2](../decisions.md#lesson-2), FR-14) is not added silently; it comes with a must-understand name:

- the top-level `kinds` list names the declaration kinds present (ADR 0004, ADR 0014);
- each operation's `features` list names the must-understand features it uses, and the top-level `features` lists their union.

A target declares the kinds and features it supports. An IR naming one it does not know fails `generate` with the kind or feature and the operation (FR-14). A feature name is added in the same PR as the member it guards. Before 1.0, the exact `irRevision` match guards such a member instead (a target reads exactly one revision, section 2), written "exact `irRevision` match (before 1.0)" in its changeset; from 1.0 a feature name is required. The 1.0 IR starts with an empty `features` list: everything in it at 1.0 is understood by every 1.0 target.

### 4. What is additive and what is breaking

| Change | Classification |
|---|---|
| a new optional member that readers may ignore | additive |
| a new member guarded by a new feature or kind name | additive (older readers refuse by name) |
| a new value of an open enum | additive (readers that act on it fail by name) |
| a new declaration kind with its sibling collection | additive |
| a new key in an extension slot | not an IR change |
| removing or renaming a member, kind or enum value | breaking |
| changing a member's type, unit or meaning | breaking |
| making an optional member required, or a nullable one non-nullable | breaking |
| changing canonical ordering, ids or serialisation (ADR 0004) | breaking: the bytes and the bundle hashes change |
| a new member whose absence makes older readers generate a weaker check, without a feature name | not allowed from 1.0; before 1.0, breaking, guarded by the exact `irRevision` match |
| a new invariant (a rule `checkIrInvariants` enforces on an existing definition) | tightening |
| must-act added to an existing definition (it names a feature, carried in `features`) | tightening |
| relaxing or removing an invariant | breaking |

A tightening makes a reader of the new revision refuse IR that an older compiler could write. It is versioned like a breaking change for readers from 1.0 (`irVersion` and the major version), unless a feature guards it: a tightening that names a feature is additive for readers that do not know the feature, since they refuse the IR by name.

Before 1.0 a breaking change is allowed with its release note (A8); from 1.0 it bumps `irVersion` and the major version, and every target states whether it reads the new version.

### 5. Readers and the seam

- The TypeScript types, the Kotlin model and the PHP model are generated from the one IR JSON Schema; no hand-written model exists (FR-40). CI regenerates the native models and fails on any difference with the committed ones.
- The golden IR of the reference contract is the shared test fixture of every reader; it changes in an IR change PR, or in a compiler change that writes other values in the same format; a format change takes the IR change path.
- The compatibility diff of contracts (FR-13) compares two IRs of the same `irVersion`. Comparing IRs of two `irVersion` values is refused with both named; a consumer recompiles the older contract first.

## Consequences

- Work on the phase 2 passes can ask for IR fields as it finds gaps, each as a small reviewed PR, without breaking other work; targets wait for the frozen-for-targets gate and then build on a stable seam.
- Exact revision matching before 1.0 means every IR change requires rebuilding every target's tests in the same CI run; this is acceptable while all targets are in the monorepo and nothing is published.
- The `features` list costs a few strings in the IR and a declaration per target, and buys the guarantee that an older target never emits a weaker check without saying so.
- After 1.0, most improvements ship as additive changes; a breaking one is rare and visible through `irVersion`.

## Traceability

- FRs: FR-37 (two-step freeze, irRevision, additive by design, open enums, extension slots), FR-14 (version ranges, refusal of an unexpressible feature), FR-40 (models generated and checked), FR-9 (versioned IR); amendments A3, A8.
- Scenarios: SCN-052, SCN-091, SCN-092, SCN-095.
- CHK items enabled: CHK-077, CHK-078.
