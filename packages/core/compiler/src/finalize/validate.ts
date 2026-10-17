import {
  type ContractIR,
  checkIrInvariants,
  createIrValidator,
  type IrValidationReport,
  type IrValidator,
  type SourceMap,
} from "@seampact/spec/ir";
import { Ajv2020 } from "ajv/dist/2020.js";

// The output check of finalize: the built IR against the strict IR JSON Schema and `checkIrInvariants`, and the side
// table against its schema. A failure means a pass wrote a member it should not have, so it is an internal error
// naming the api, the pointer and the rule, never a diagnostic for the author.

let strictValidator: IrValidator | undefined;

// Compiling the schemas takes a while: one validator serves every api of the process.
function validator(): IrValidator {
  strictValidator ??= createIrValidator(Ajv2020, "strict");

  return strictValidator;
}

/** Every failure of a report, each as its rule and pointer. */
function reportFailures(report: IrValidationReport): string[] {
  return [
    ...report.problems.map(
      (problem) => `schema '${problem.keyword}' at '${problem.pointer}': ${problem.message}`,
    ),
    ...report.unknownMembers.map((pointer) => `schema 'unknown member' at '${pointer}'`),
    ...report.unknownKinds.map(
      (kind) => `schema 'unknown ${kind.tag}' at '${kind.pointer}': '${kind.value}'`,
    ),
    ...report.unknownValues.map(
      (value) => `schema 'unknown value' at '${value.pointer}': '${value.value}'`,
    ),
  ];
}

function invalid(api: string, what: string, failures: readonly string[]): Error {
  return new Error(
    `finalize built an invalid ${what} for api '${api}', so a pass wrote a member it should not have: ${failures.join("; ")}.`,
  );
}

/** Checks the built IR, which is then a `ContractIR`; throws an internal error naming every failure otherwise. */
export function finalizeAssertIr(api: string, candidate: unknown): asserts candidate is ContractIR {
  const report = validator().validate(candidate);

  if (!report.valid) throw invalid(api, "IR", reportFailures(report));
  const violations = checkIrInvariants(candidate);

  if (violations.length > 0)
    throw invalid(
      api,
      "IR",
      violations.map(
        (violation) =>
          `invariant '${violation.id}' at '${violation.pointer}': ${violation.message}`,
      ),
    );
}

/** Checks the built side table against its schema; throws an internal error naming every failure otherwise. */
export function finalizeAssertSourceMap(api: string, sourceMap: SourceMap): void {
  const report = validator().validateSourceMap(sourceMap);

  if (!report.valid) throw invalid(api, "side table", reportFailures(report));
}
