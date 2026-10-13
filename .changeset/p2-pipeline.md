---
"@seampact/spec": patch
"@seampact/compiler": patch
---

Add `IrWriter` to `@seampact/spec/ir`: the closed writer view of the IR types, generated from the IR schema, with every union reduced to its known variants and every open enum to its known values, for the compiler passes. It is a package addition, not an IR change: the schema and `irRevision` are unchanged.

Add the phase 2 pipeline seam to `@seampact/compiler`: the draft IR, the pass interface split into six halves, the field-ownership table, the read/write guard (`pipelineGuard`, `DraftAccessError`), and the derivation table and roles of ADR 0006 as data (`derivationTable`, `derivationRoles`, `isDerivationId`).

Add the pipeline orchestrator `compileWorkspace` (load, validate, relay order, the six halves per api, link, finalize, under the stop rule of ADR 0006 section 1), the tree-node model (`pipelineTreeNodes`), the inherited-setting reader (`pipelineInherited`), the resolved conventions with the core defaults as data (`pipelineConventions`, read by a `ConventionPath` of the conventions schema), the size and duration readers, read-only views of what a guarded half reads (`PipelineReadonlyError`) and the copy a half stores instead (`pipelineCopy`), the context builder pass tests use (`pipelineContext`), the default parts read at run time (`pipelineDefaultParts()`), and the typed stubs each pass lane, link and finalize fill (`treeSchemasPass` to `deriveErrorsPass`, `linkPass`, `finalizeIr`, `workspaceRelayOrder`), which import the pipeline through its seam barrel (`pipeline/seam.ts`). `compileWorkspace` returns the files the load read, for the watch primitive.
