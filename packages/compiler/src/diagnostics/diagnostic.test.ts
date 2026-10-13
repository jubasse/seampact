import type { Origin } from "@seampact/spec/ir";
import { expectTypeOf, test } from "vitest";
import type { Diagnostic, DiagnosticOrigin, RelatedLocation } from "./diagnostic.js";

// A core declaration has no file and no side-table entry (ADR 0004 sections 6 and 11): no diagnostic is located
// at one.
test("a diagnostic is never located at a core origin (checked by typecheck)", () => {
  expectTypeOf<Diagnostic["origin"]>().toEqualTypeOf<DiagnosticOrigin>();
  expectTypeOf<RelatedLocation["origin"]>().toEqualTypeOf<DiagnosticOrigin>();
  expectTypeOf<{ layer: "core"; pointer: string }>().not.toExtend<DiagnosticOrigin>();
  expectTypeOf<{ layer: "workspace"; pointer: string }>().toExtend<DiagnosticOrigin>();
  expectTypeOf<{ api: string; layer: "pack:acme"; pointer: string }>().toExtend<DiagnosticOrigin>();
  expectTypeOf<DiagnosticOrigin>().toExtend<Origin>();
});
