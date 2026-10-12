import type { ContractIR, Operation } from "./types.generated.js";

// What a reader declares it reads (ADR 0005 sections 2 and 3): the irVersion values, the exact irRevision
// (before 1.0), and the declaration kinds and must-understand features it supports.
export interface IrSupport {
  irVersions: readonly number[];
  irRevision: number;
  kinds: readonly string[];
  features: readonly string[];
}

export type IrSupportCode =
  | "ir.version.unsupported"
  | "ir.revision.mismatch"
  | "ir.kind.unsupported"
  | "ir.feature.unsupported";

export interface IrSupportMismatch {
  code: IrSupportCode;
  member: string; // a JSON Pointer into the IR
  value: string | number;
  expected: readonly (string | number)[];
  operation?: string; // the operation id, for a per-operation kind or feature
  message: string;
}

// The members of an IR this check reads; a ContractIR is one. Anything else in the document is ignored.
export type IrSupportInput = Pick<ContractIR, "irVersion" | "irRevision" | "kinds" | "features"> & {
  operations: readonly Pick<Operation, "kind" | "id" | "features">[];
};

// Returns one named mismatch per unsupported irVersion, different irRevision, unknown kind or unknown
// feature, top level and per operation (with its id). A pure function: the caller (the CLI before a TypeScript
// target, the Kotlin and PHP models on read) decides to fail and writes no file (SCN-052, SCN-091, SCN-092).
export function checkIrSupport(ir: IrSupportInput, support: IrSupport): IrSupportMismatch[] {
  const mismatches: IrSupportMismatch[] = [];
  if (!support.irVersions.includes(ir.irVersion)) {
    mismatches.push({
      code: "ir.version.unsupported",
      member: "/irVersion",
      value: ir.irVersion,
      expected: support.irVersions,
      message: `irVersion ${ir.irVersion} is not one this reader reads (${support.irVersions.join(", ")}).`,
    });
  }
  if (ir.irRevision !== support.irRevision) {
    mismatches.push({
      code: "ir.revision.mismatch",
      member: "/irRevision",
      value: ir.irRevision,
      expected: [support.irRevision],
      message: `irRevision ${ir.irRevision} differs from the revision this reader was built for (${support.irRevision}).`,
    });
  }
  const unknownIn = (
    values: readonly string[] | undefined,
    known: readonly string[],
    code: "ir.kind.unsupported" | "ir.feature.unsupported",
    member: string,
    operation?: string,
  ) => {
    const what = code === "ir.kind.unsupported" ? "declaration kind" : "feature";
    (values ?? []).forEach((value, index) => {
      if (known.includes(value)) return;
      const where = operation === undefined ? "" : ` in operation '${operation}'`;
      mismatches.push({
        code,
        member: `${member}/${index}`,
        value,
        expected: known,
        ...(operation === undefined ? {} : { operation }),
        message: `The ${what} '${value}'${where} is not supported by this reader.`,
      });
    });
  };
  unknownIn(ir.kinds, support.kinds, "ir.kind.unsupported", "/kinds");
  unknownIn(ir.features, support.features, "ir.feature.unsupported", "/features");
  (ir.operations ?? []).forEach((operation, index) => {
    if (!support.kinds.includes(operation.kind)) {
      mismatches.push({
        code: "ir.kind.unsupported",
        member: `/operations/${index}/kind`,
        value: operation.kind,
        expected: support.kinds,
        operation: operation.id,
        message: `The declaration kind '${operation.kind}' of operation '${operation.id}' is not supported by this reader.`,
      });
    }
    unknownIn(
      operation.features,
      support.features,
      "ir.feature.unsupported",
      `/operations/${index}/features`,
      operation.id,
    );
  });
  return mismatches;
}
