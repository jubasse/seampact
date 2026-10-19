import {
  findIrSensitiveParamReaches,
  type IrSensitiveReach,
  type IrWriter,
} from "@seampact/spec/ir";
import type { ConventionReading, PassContext, PassReadonly } from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";
import type { DeriveErrorsReporter } from "./report.js";

// An error code whose params carry a sensitive value (ADR 0003 section 6): a property marked sensitive, or a
// scalar use marked sensitive, at any depth of the params schema. Every response of the code is no-store under
// `conventions.cache.sensitiveElsewhere: noStore`, the default (`ErrorDecl.noStore`), and the declaration is a
// compile error under `refuse`, located at its params.

const REFUSE_ELSEWHERE = "refuse";

/** What the check reads: the conventions, the reporter and the schemas tree.schemas wrote. */
export interface DeriveErrorsSensitiveSources {
  readonly context: PassContext;
  readonly reporter: DeriveErrorsReporter;
  readonly schemas: PassReadonly<Record<IrWriter.SchemaId, IrWriter.Schema>>;
}

/** An error code's params, and the pointer a refusal is located at. */
export interface DeriveErrorsSensitiveSite {
  readonly code: string;
  readonly params: IrWriter.SchemaRef;
  readonly pointer: string;
}

/** Whether the params of the code make it no-store; under `refuse`, a sensitive value is reported and it is not. */
export function deriveErrorsParamsNoStore(
  site: DeriveErrorsSensitiveSite,
  sources: DeriveErrorsSensitiveSources,
): boolean {
  const [found] = findIrSensitiveParamReaches(site.params, sources.schemas, (id) => {
    throw new Error(
      `the params of ${quote(site.code)} reference schema '${id}', which tree.schemas did not write`,
    );
  });

  if (found === undefined) return false;
  const policy = sources.context.conventions.get("cache.sensitiveElsewhere");

  if (policy?.value !== REFUSE_ELSEWHERE) return true;

  reportRefused(site, found, policy, sources.reporter);

  return false;
}

function reportRefused(
  site: DeriveErrorsSensitiveSite,
  found: IrSensitiveReach,
  policy: ConventionReading,
  reporter: DeriveErrorsReporter,
): void {
  reporter.error({
    rule: "cache-sensitive-elsewhere",
    message: `conventions.cache.sensitiveElsewhere is refuse, so the params of error ${quote(site.code)} may not carry ${reachText(found)}`,
    fix: "Drop the sensitive mark from the params, or set conventions.cache.sensitiveElsewhere: noStore.",
    pointer: site.pointer,
    ...(policy.origin === undefined
      ? {}
      : { related: [{ pointer: policy.origin.pointer, message: "the convention" }] }),
  });
}

function reachText(reach: IrSensitiveReach): string {
  switch (reach.place) {
    case "field":
      return `the sensitive field '${reach.schema}.${reach.property}'`;
    case "mapKey":
      return `the sensitive keys of map '${reach.schema}'`;
    case "body":
    case "header":
      return "a sensitive value";
  }
}
