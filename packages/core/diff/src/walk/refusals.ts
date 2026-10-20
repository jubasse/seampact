import { type ApiVersion, type ContractIR, isKnownVariant } from "@seampact/spec/ir";
import { DIFF_CODES } from "../diff-codes.js";
import type { DiffRefusal } from "../result.js";
import { unknownValueRefusal } from "./context.js";
import { isSameJson } from "./json.js";
import { isKnownMaturity } from "./maturity.js";

// The refusals of the whole diff: two IR formats, two apis, two api versions, or a value the gate must act on
// that this diff does not know.

const KNOWN_COMPAT_POLICIES: ReadonlySet<string> = new Set(["additive-only", "none"]);

export function wholeDiffRefusals(before: ContractIR, after: ContractIR): DiffRefusal[] {
  const refusals: DiffRefusal[] = [];

  if (before.irVersion !== after.irVersion) {
    refusals.push({
      code: DIFF_CODES.irVersionDiffers,
      message: `The baseline IR has irVersion ${before.irVersion} and the new one ${after.irVersion}; a diff compares one irVersion.`,
      fix: "Recompile the older contract with this compiler, then diff again.",
      before: before.irVersion,
      after: after.irVersion,
    });
  } else if (before.irRevision !== after.irRevision) {
    refusals.push({
      code: DIFF_CODES.irRevisionDiffers,
      message: `The baseline IR has irRevision ${before.irRevision} and the new one ${after.irRevision}; before 1.0 a diff compares one revision.`,
      fix: "Rebuild the baseline with this compiler (a bundle carries its sources), then diff again.",
      before: before.irRevision,
      after: after.irRevision,
    });
  }

  if (before.api.id !== after.api.id) {
    refusals.push({
      code: DIFF_CODES.apiNameDiffers,
      message: `The baseline is the api ${before.api.id} and the new IR the api ${after.api.id}.`,
      fix: "Diff each api against a baseline of the same api.",
      before: before.api.id,
      after: after.api.id,
    });
  } else if (!isSameJson(before.api.version, after.api.version)) {
    refusals.push({
      code: DIFF_CODES.apiVersionDiffers,
      message: `The api ${after.api.id} moves from version ${apiVersionText(before.api.version)} to ${apiVersionText(after.api.version)}; a new path version is a new api.`,
      fix: "Diff the new version against a baseline of the same version; the old version keeps its own.",
      before: apiVersionText(before.api.version),
      after: apiVersionText(after.api.version),
    });
  }

  return [...refusals, ...gateValueRefusals(before), ...gateValueRefusals(after)];
}

/** `v1` for a path version, the label otherwise. */
export function apiVersionText(version: ApiVersion): string {
  if (!isKnownVariant("ApiVersion", version)) return JSON.stringify(version);

  return version.kind === "path" ? `v${version.number}` : version.label;
}

// The values the gate acts on: the policy, the api maturity and each operation's maturity level.
function gateValueRefusals(ir: ContractIR): DiffRefusal[] {
  const refusals: DiffRefusal[] = [];
  const unknown = (member: string, value: string, operations: string[]) =>
    refusals.push(unknownValueRefusal(member, value, operations));

  if (!KNOWN_COMPAT_POLICIES.has(ir.api.compat.policy))
    unknown("/api/compat/policy", ir.api.compat.policy, []);

  if (!isKnownMaturity(ir.api.maturity)) unknown("/api/maturity", ir.api.maturity, []);

  ir.operations.forEach((operation, index) => {
    if (!isKnownMaturity(operation.maturity.level)) {
      unknown(`/operations/${index}/maturity/level`, operation.maturity.level, [operation.id]);
    }
  });

  return refusals;
}
