import {
  type ContractIR,
  checkIrInvariants,
  createIrValidator,
  type IrValidationReport,
  type IrValidator,
  type SourceMap,
} from "@seampact/spec/ir";
import { Ajv2020 } from "ajv/dist/2020.js";
import { quote } from "../validate/diagnostics.js";
import { finalizeIsRecord as isRecord } from "./record.js";

// The output check of finalize: the built IR against the strict IR JSON Schema and `checkIrInvariants`, and the side
// table against its schema. A failure means a pass wrote a member it should not have, so it is an internal error
// naming the api, the pointer and the rule, never a diagnostic for the author.

let strictValidator: IrValidator | undefined;

// Compiling the schemas takes a while: one validator serves every api of the process.
function validator(): IrValidator {
  strictValidator ??= createIrValidator(Ajv2020, "strict");

  return strictValidator;
}

// An internal error lists at most this many failures, then how many more there are.
const LISTED_FAILURE_LIMIT = 10;
const OPERATION_POINTER = /^\/operations\/(\d+)(?:\/|$)/;

/** One failure: its rule, its pointer and, when it has one, the message or the value it refuses. */
interface ValidationFailure {
  readonly rule: string;
  readonly pointer: string;
  readonly detail?: string;
}

/** Every failure of a report; a refused value is quoted and cut, as it may be an author's text. */
function reportFailures(report: IrValidationReport): ValidationFailure[] {
  return [
    ...report.problems.map((problem) => ({
      rule: `schema '${problem.keyword}'`,
      pointer: problem.pointer,
      detail: problem.message,
    })),
    ...report.unknownMembers.map((pointer) => ({ rule: "schema 'unknown member'", pointer })),
    ...report.unknownKinds.map((kind) => ({
      rule: `schema 'unknown ${kind.tag}'`,
      pointer: kind.pointer,
      detail: quote(kind.value),
    })),
    ...report.unknownValues.map((value) => ({
      rule: "schema 'unknown value'",
      pointer: value.pointer,
      detail: quote(value.value),
    })),
  ];
}

// The id of the operation a pointer is inside, so a pass author finds it without counting sorted operations.
function operationIdAt(candidate: unknown, pointer: string): string | undefined {
  const index = OPERATION_POINTER.exec(pointer)?.[1];
  const operations: unknown = isRecord(candidate) ? candidate.operations : undefined;

  if (index === undefined || !Array.isArray(operations)) return undefined;
  const operation: unknown = operations[Number(index)];

  return isRecord(operation) && typeof operation.id === "string" ? operation.id : undefined;
}

function describeFailure(candidate: unknown, failure: ValidationFailure): string {
  const operationId = operationIdAt(candidate, failure.pointer);
  const where =
    operationId === undefined
      ? `'${failure.pointer}'`
      : `'${failure.pointer}' (operation ${quote(operationId)})`;

  return failure.detail === undefined
    ? `${failure.rule} at ${where}`
    : `${failure.rule} at ${where}: ${failure.detail}`;
}

function invalid(
  api: string,
  what: string,
  candidate: unknown,
  failures: readonly ValidationFailure[],
): Error {
  const listed = failures
    .slice(0, LISTED_FAILURE_LIMIT)
    .map((failure) => describeFailure(candidate, failure));
  const more = failures.length - listed.length;
  const tail = more > 0 ? `; and ${more} more` : "";

  return new Error(
    `finalize built an invalid ${what} for api '${api}', so a pass wrote a member it should not have: ${listed.join("; ")}${tail}.`,
  );
}

/** Checks the built IR, which is then a `ContractIR`; throws an internal error naming every failure otherwise. */
export function finalizeAssertIr(api: string, candidate: unknown): asserts candidate is ContractIR {
  const report = validator().validate(candidate);

  if (!report.valid) throw invalid(api, "IR", candidate, reportFailures(report));
  const violations = checkIrInvariants(candidate);

  if (violations.length > 0)
    throw invalid(
      api,
      "IR",
      candidate,
      violations.map((violation) => ({
        rule: `invariant '${violation.id}'`,
        pointer: violation.pointer,
        detail: violation.message,
      })),
    );
}

/** Checks the built side table against its schema; throws an internal error naming every failure otherwise. */
export function finalizeAssertSourceMap(api: string, sourceMap: SourceMap): void {
  const report = validator().validateSourceMap(sourceMap);

  if (!report.valid) throw invalid(api, "side table", sourceMap, reportFailures(report));
}
