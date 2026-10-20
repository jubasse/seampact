import type { BundleApi, BundleFailure } from "@seampact/spec/bundle";
import {
  type ContractIR,
  checkIrSupport,
  createIrValidator,
  IR_REVISION,
  IR_VERSION,
  type IrSupportCode,
  type IrValidationReport,
  type IrValidator,
} from "@seampact/spec/ir";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseUntrustedJson, utf8Text } from "./untrusted-json.js";

// Step 3 of the pinned-bundle check, for one api: the IR file is JSON with no reserved key, declares the irVersion
// and irRevision the manifest lists, is of a version this reader reads at its exact irRevision (before 1.0, ADR
// 0005), and validates under the open IR JSON Schema, the form a reader uses. Kinds and features are a target's
// question (`checkIrSupport` with its own support), not the bundle's.

const LISTED_PROBLEM_LIMIT = 5;
const FIX =
  "Rebuild the bundle with a compiler of this IR revision, or use the seampact release that reads it.";

let openValidator: IrValidator | undefined;

// Compiling the schemas takes a while: one validator serves the process.
function validator(): IrValidator {
  openValidator ??= createIrValidator(Ajv2020, "open");

  return openValidator;
}

/** The api's IR, or the failure naming its file and the values that differ. */
export function checkBundleIr(api: BundleApi, bytes: Uint8Array): ContractIR | BundleFailure {
  const text = utf8Text(bytes);
  const parsed =
    text === undefined
      ? { ok: false as const, problem: "is not UTF-8 text" }
      : parseUntrustedJson(text);

  if (!parsed.ok)
    return {
      code: "bundle.ir-unreadable",
      message: `'${api.file}' ${parsed.problem}.`,
      fix: FIX,
      file: api.file,
    };

  const document = parsed.value;
  const declared = declaredVersion(document);

  if (declared.irVersion !== api.irVersion || declared.irRevision !== api.irRevision)
    return {
      code: "bundle.ir-declaration",
      message: `'${api.file}' declares irVersion ${String(declared.irVersion)} and irRevision ${String(declared.irRevision)}; the manifest lists ${api.irVersion} and ${api.irRevision}.`,
      fix: FIX,
      file: api.file,
      expected: `${api.irVersion}.${api.irRevision}`,
      actual: `${String(declared.irVersion)}.${String(declared.irRevision)}`,
    };

  const support = supportFailure(api, document);

  if (support !== undefined) return support;

  return validIr(api, document);
}

// This reader's version and exact revision; kinds and features are left to the target that reads the IR.
const READER_SUPPORT = {
  irVersions: [IR_VERSION],
  irRevision: IR_REVISION,
  kinds: [],
  features: [],
};

const SUPPORT_CODES: Partial<Record<IrSupportCode, BundleFailure["code"]>> = {
  "ir.version.unsupported": "bundle.ir-version",
  "ir.revision.mismatch": "bundle.ir-revision",
  "ir.support.malformed": "bundle.ir-invalid",
};

function supportFailure(api: BundleApi, document: unknown): BundleFailure | undefined {
  for (const mismatch of checkIrSupport(document, READER_SUPPORT)) {
    const code = SUPPORT_CODES[mismatch.code];

    if (code === undefined) continue;

    return {
      code,
      message: `'${api.file}': ${mismatch.message}`,
      fix: FIX,
      file: api.file,
      expected: mismatch.expected.join(", "),
      actual: String(mismatch.value),
    };
  }

  return undefined;
}

function declaredVersion(document: unknown): { irVersion: unknown; irRevision: unknown } {
  if (typeof document !== "object" || document === null || Array.isArray(document))
    return { irVersion: undefined, irRevision: undefined };

  return {
    irVersion: Reflect.get(document, "irVersion"),
    irRevision: Reflect.get(document, "irRevision"),
  };
}

function validIr(api: BundleApi, document: unknown): ContractIR | BundleFailure {
  const report = validator().validate(document);
  const problems = reportProblems(report);

  if (problems.length === 0 && isContractIr(document, report)) return document;

  const listed = problems.slice(0, LISTED_PROBLEM_LIMIT);
  const more = problems.length - listed.length;

  return {
    code: "bundle.ir-invalid",
    message: `'${api.file}' is not valid under the IR JSON Schema: ${listed.join("; ")}${more > 0 ? `; and ${more} more` : ""}.`,
    fix: FIX,
    file: api.file,
  };
}

function reportProblems(report: IrValidationReport): string[] {
  return [
    ...report.problems.map((problem) => `at '${problem.pointer}' ${problem.message}`),
    ...(report.valid
      ? []
      : report.unknownKinds.map((kind) => `at '${kind.pointer}' an unknown ${kind.tag}`)),
    ...(report.valid
      ? []
      : report.unknownValues.map((value) => `at '${value.pointer}' an unknown value`)),
  ];
}

// The open schema's verdict is what makes the document a ContractIR.
function isContractIr(document: unknown, report: IrValidationReport): document is ContractIR {
  return report.valid && typeof document === "object" && document !== null;
}
