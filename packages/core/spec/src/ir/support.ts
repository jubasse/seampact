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
  | "ir.feature.unsupported"
  | "ir.support.malformed";

export interface IrSupportMismatch {
  code: IrSupportCode;
  member: string; // a JSON Pointer into the IR
  value: string | number; // for ir.support.malformed: the JSON type found ('missing', 'object'...)
  expected: readonly (string | number)[];
  operation?: string; // the operation id, for a per-operation kind or feature
  message: string;
}

// The members of an IR this check reads; a ContractIR is one. Anything else in the document is ignored, and
// `checkIrSupport` takes any value: it reads these members as untrusted data.
export type IrSupportInput = Pick<ContractIR, "irVersion" | "irRevision" | "kinds" | "features"> & {
  operations: readonly Pick<Operation, "kind" | "id" | "features">[];
};

const jsonType = (value: unknown): string =>
  value === undefined
    ? "missing"
    : value === null
      ? "null"
      : Array.isArray(value)
        ? "array"
        : typeof value;

const shown = (value: unknown): string | number =>
  typeof value === "string" || typeof value === "number"
    ? value
    : (JSON.stringify(value) ?? "missing");

// Returns one named mismatch per unsupported irVersion, different irRevision, unknown kind or unknown
// feature, top level and per operation (with its id). An unsupported irVersion is returned alone and at once:
// the rest of the document may have another shape. A list that is missing or not an array is named
// (`ir.support.malformed`), never read as empty. A pure function that reads the document as untrusted data
// and never throws: the caller (the CLI before a TypeScript target, the Kotlin and PHP models on read) decides
// to fail and writes no file (SCN-052, SCN-091, SCN-092).
export function checkIrSupport(ir: unknown, support: IrSupport): IrSupportMismatch[] {
  const doc = (typeof ir === "object" && ir !== null ? ir : {}) as Record<string, unknown>;
  const version = doc.irVersion;

  if (typeof version !== "number" || !support.irVersions.includes(version)) {
    return [
      {
        code: "ir.version.unsupported",
        member: "/irVersion",
        value: shown(version),
        expected: support.irVersions,
        message: `irVersion ${shown(version)} is not one this reader reads (${support.irVersions.join(", ")}).`,
      },
    ];
  }

  const mismatches: IrSupportMismatch[] = [];

  if (doc.irRevision !== support.irRevision) {
    mismatches.push({
      code: "ir.revision.mismatch",
      member: "/irRevision",
      value: shown(doc.irRevision),
      expected: [support.irRevision],
      message: `irRevision ${shown(doc.irRevision)} differs from the revision this reader was built for (${support.irRevision}).`,
    });
  }

  const list = (value: unknown, member: string, operation?: string): unknown[] | undefined => {
    if (Array.isArray(value)) return value;
    mismatches.push({
      code: "ir.support.malformed",
      member,
      value: jsonType(value),
      expected: ["array"],
      ...(operation === undefined ? {} : { operation }),
      message: `${member} is ${jsonType(value)}, not an array: this reader cannot check what it supports.`,
    });

    return undefined;
  };

  const unknownIn = (
    values: unknown[] | undefined,
    known: readonly string[],
    code: "ir.kind.unsupported" | "ir.feature.unsupported",
    member: string,
    operation?: string,
  ) => {
    const what = code === "ir.kind.unsupported" ? "declaration kind" : "feature";

    (values ?? []).forEach((value, index) => {
      if (typeof value === "string" && known.includes(value)) return;
      const where = operation === undefined ? "" : ` in operation '${operation}'`;

      mismatches.push({
        code,
        member: `${member}/${index}`,
        value: shown(value),
        expected: known,
        ...(operation === undefined ? {} : { operation }),
        message: `The ${what} '${shown(value)}'${where} is not supported by this reader.`,
      });
    });
  };

  unknownIn(list(doc.kinds, "/kinds"), support.kinds, "ir.kind.unsupported", "/kinds");
  unknownIn(
    list(doc.features, "/features"),
    support.features,
    "ir.feature.unsupported",
    "/features",
  );
  (list(doc.operations, "/operations") ?? []).forEach((entry, index) => {
    const operation = (typeof entry === "object" && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >;
    const id = typeof operation.id === "string" ? operation.id : `#${index}`;

    if (typeof operation.kind !== "string" || !support.kinds.includes(operation.kind)) {
      mismatches.push({
        code: "ir.kind.unsupported",
        member: `/operations/${index}/kind`,
        value: shown(operation.kind),
        expected: support.kinds,
        operation: id,
        message: `The declaration kind '${shown(operation.kind)}' of operation '${id}' is not supported by this reader.`,
      });
    }

    const member = `/operations/${index}/features`;

    unknownIn(
      list(operation.features, member, id),
      support.features,
      "ir.feature.unsupported",
      member,
      id,
    );
  });

  return mismatches;
}
