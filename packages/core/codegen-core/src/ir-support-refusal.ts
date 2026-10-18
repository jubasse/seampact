import { checkIrSupport, type IrSupportMismatch } from "@seampact/spec/ir";
import type { Refusal } from "./refusal.js";
import type { AnyTargetMetadata } from "./target.js";

// Runs spec's IR support check for a target and names, beyond it, the target package to update with the IR's
// value and the expected one (ADR 0005 section 2). Any mismatch means no file is produced.
export function refuseUnsupportedIr(ir: unknown, metadata: AnyTargetMetadata): Refusal[] {
  return checkIrSupport(ir, metadata.irSupport).map((mismatch) => toRefusal(mismatch, metadata));
}

function toRefusal(mismatch: IrSupportMismatch, metadata: AnyTargetMetadata): Refusal {
  const target = `${metadata.packageName} ${metadata.packageVersion}`;
  const expected = mismatch.expected.length === 0 ? "none" : mismatch.expected.join(", ");

  return {
    code: mismatch.code,
    message: `${mismatch.message} The IR has ${mismatch.value}; ${target} expects ${expected}.`,
    fix: fixFor(mismatch, metadata.packageName),
    member: mismatch.member,
    ...(mismatch.operation === undefined ? {} : { operation: mismatch.operation }),
  };
}

function fixFor(mismatch: IrSupportMismatch, packageName: string): string {
  switch (mismatch.code) {
    case "ir.version.unsupported":
    case "ir.revision.mismatch":
      return `Update ${packageName} to the release built for the IR this seampact version writes, or use the seampact version ${packageName} was built with.`;
    case "ir.kind.unsupported":
    case "ir.feature.unsupported":
      return `Update ${packageName} to a release that supports '${mismatch.value}', or remove its use from the contract.`;
    case "ir.support.malformed":
      return "Regenerate the IR with seampact: this document is not one it wrote.";
  }
}
