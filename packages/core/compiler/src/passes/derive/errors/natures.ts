import type { IrWriter } from "@seampact/spec/ir";
import { type PassContext, pipelinePointerBelow } from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";
import {
  deriveErrorsDocs,
  deriveErrorsEntries,
  deriveErrorsOriginOf,
  deriveErrorsString,
} from "./read.js";
import type { DeriveErrorsReporter } from "./report.js";

// The `natures` catalogue (ADR 0002 section 11, A40): each contract or pack nature mapped onto one of the three
// base natures every client's retry rule reads. A nature named like a base is refused with the allowed values; the
// authoring schema refuses a mapping onto anything but a base.

/** The base natures, in the order of ADR 0002 section 11. */
export const deriveErrorsBaseNatures: readonly IrWriter.NatureBase[] = Object.freeze([
  "refused",
  "unavailable",
  "failed",
]);

export const deriveErrorsIsBaseNature = (text: string): text is IrWriter.NatureBase =>
  deriveErrorsBaseNatures.some((base) => base === text);

const ALLOWED_BASES = deriveErrorsBaseNatures.join(", ");

/** The declared natures, each mapped onto its base; a refused one is reported and left out. */
export function deriveErrorsNatures(
  context: PassContext,
  reporter: DeriveErrorsReporter,
): Map<IrWriter.NatureId, IrWriter.NatureDecl> {
  const natures = new Map<IrWriter.NatureId, IrWriter.NatureDecl>();

  for (const [id, declaration] of deriveErrorsEntries(context.raw.merged.natures)) {
    const pointer = pipelinePointerBelow("/natures", id);
    const base = deriveErrorsString(declaration, "base");

    if (deriveErrorsIsBaseNature(id)) {
      reporter.error({
        rule: "nature-base",
        message: `nature ${quote(id)} is named like a base nature; the base natures are ${ALLOWED_BASES}`,
        fix: `rename the nature, or use the base nature ${quote(id)} directly on the error`,
        pointer,
      });
      continue;
    }

    // The authoring schema admits only a base here, and the validate stage runs first.
    if (base === undefined || !deriveErrorsIsBaseNature(base))
      throw new Error(
        `nature '${id}' maps onto '${base ?? ""}', which the authoring schema refuses`,
      );

    natures.set(id, {
      id,
      base,
      docs: deriveErrorsDocs(declaration),
      origin: deriveErrorsOriginOf(context, pointer),
    });
  }

  return natures;
}
