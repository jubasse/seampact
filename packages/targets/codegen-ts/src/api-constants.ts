import {
  below,
  type IrLocation,
  operationLocation,
  type Refusal,
  refuseInconsistentIr,
  typeScriptIdentifier,
} from "@seampact/codegen-core";
import type { ContractIR } from "@seampact/spec/ir";
import { splitName } from "@seampact/spec/naming";
import { HTTP_REASON_PHRASES } from "./http-reason-phrases.js";
import { ETAG_DERIVATION } from "./operation-output.js";

export const STATUS_CONSTANT = "Status";
export const ERROR_CODE_CONSTANT = "ErrorCode";

interface ConstantEntry {
  key: string;
  value: number | string;
}

// The api's `Status` and `ErrorCode` const objects, so a handler writes `Status.NotFound` and
// `ErrorCode.ApiNotFound` as literal types without `as const`. A key is the ADR 0007 type identifier of the
// reason phrase's or the code's words; a status without a reason phrase and two codes of one key are refused.
export function apiConstantsSource(ir: ContractIR, refusals: Refusal[]): string {
  const statusEntries = statusConstantEntries(ir, refusals);
  const errorCodeEntries = errorCodeConstantEntries(ir, refusals);

  return [
    constantDeclaration(
      "The HTTP statuses this api's operations answer, by reason phrase.",
      STATUS_CONSTANT,
      statusEntries,
    ),
    constantDeclaration(
      "Every error code of this api, by its words.",
      ERROR_CODE_CONSTANT,
      errorCodeEntries,
    ),
  ].join("\n\n");
}

function constantDeclaration(
  documentation: string,
  constantName: string,
  entries: readonly ConstantEntry[],
): string {
  const members = entries.map((entry) => `${entry.key}: ${JSON.stringify(entry.value)},`);

  return `/** ${documentation} */\nexport const ${constantName} = { ${members.join(" ")} } as const;`;
}

function wordsIdentifier(words: readonly string[]): string {
  return typeScriptIdentifier({ segments: [...words], role: "schema" });
}

// Each status a handler returns, a success response or an error code's status, with the first place that uses it.
function statusConstantEntries(ir: ContractIR, refusals: Refusal[]): ConstantEntry[] {
  const statusLocations = new Map<number, IrLocation>();

  ir.operations.forEach((operation, operationIndex) => {
    const location = operationLocation(operationIndex, operation.id);

    operation.responses.forEach((response, responseIndex) => {
      if (response.derivedFrom?.derivation === ETAG_DERIVATION) return;

      if (!statusLocations.has(response.status)) {
        statusLocations.set(response.status, below(location, "responses", responseIndex, "status"));
      }
    });

    // An undeclared code is refused by the errors module.
    for (const error of operation.errors) {
      const declaration = Object.hasOwn(ir.errors, error.code) ? ir.errors[error.code] : undefined;
      const status = declaration?.http.status;

      if (status !== undefined && !statusLocations.has(status)) {
        statusLocations.set(status, below({ member: "" }, "errors", error.code, "http", "status"));
      }
    }
  });

  const statuses = [...statusLocations.keys()].sort((left, right) => left - right);

  return statuses.flatMap((status) => {
    const reasonPhrase = HTTP_REASON_PHRASES.get(status);

    if (reasonPhrase === undefined) {
      refusals.push(statusWithoutReasonPhrase(status, statusLocations.get(status)));

      return [];
    }

    return [{ key: wordsIdentifier(splitName(reasonPhrase)), value: status }];
  });
}

function statusWithoutReasonPhrase(status: number, location: IrLocation | undefined): Refusal {
  return {
    code: "status.reasonPhrase.unknown",
    message: `The status ${status} of ${location?.member ?? "the api"} has no reason phrase in the IANA HTTP status code registry, so the Status constant cannot name it.`,
    fix: "Answer with a registered HTTP status.",
    member: location?.member ?? "",
    ...(location?.operation === undefined ? {} : { operation: location.operation }),
  };
}

function errorCodeConstantEntries(ir: ContractIR, refusals: Refusal[]): ConstantEntry[] {
  const codeByKey = new Map<string, string>();

  return Object.keys(ir.errors).flatMap((code) => {
    const location = below({ member: "" }, "errors", code);
    const words = splitName(code);

    if (words.length === 0) {
      refusals.push(
        refuseInconsistentIr("error.code.words", `The error code '${code}' has no word`, location),
      );

      return [];
    }

    const key = wordsIdentifier(words);
    const clashingCode = codeByKey.get(key);

    if (clashingCode !== undefined) {
      refusals.push(errorCodeKeyClash(code, clashingCode, key, location));

      return [];
    }

    codeByKey.set(key, code);

    return [{ key, value: code }];
  });
}

function errorCodeKeyClash(
  code: string,
  clashingCode: string,
  key: string,
  location: IrLocation,
): Refusal {
  return {
    code: "errorCode.key.duplicate",
    message: `The error codes '${clashingCode}' and '${code}' both give the key '${key}' of the ErrorCode constant.`,
    fix: "Rename one of the two codes so that their words differ.",
    member: location.member,
  };
}
