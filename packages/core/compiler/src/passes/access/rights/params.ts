import { pipelineCopy } from "../../../pipeline/seam.js";
import { type AccessRightsReporter, type AccessRightsRule, accessRightsQuoted } from "./report.js";
import type { AccessRightsContext } from "./schema-use.js";

// The params a use gives a right or rule (a requirement, a field's `restrictedTo`) fit the params schema the
// right or rule declares (ADR 0002 section 9), checked by the schema service.

export interface AccessRightsParamsUse {
  readonly rule: Extract<AccessRightsRule, "requirement-params" | "field-right-params">;
  /** What declares the params. */
  readonly kind: "right" | "rule";
  readonly name: string;
  /** What gives them: `the requirement`. */
  readonly holder: string;
  /** The params schema the target declares, if any. */
  readonly schema: string | undefined;
  readonly params: unknown;
  /** Where the params are written. */
  readonly paramsPointer: string;
  /** Where the use is written, for params that are missing. */
  readonly usePointer: string;
}

/** The params of a use, copied, when they fit; undefined after an error. */
export function accessRightsCheckParams(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  use: AccessRightsParamsUse,
): { readonly params?: unknown } | undefined {
  const target = `${use.kind} '${use.name}'`;

  if (use.schema === undefined) {
    if (use.params === undefined) return {};
    reporter.error({
      rule: use.rule,
      message: `${target} declares no params, but ${use.holder} gives some`,
      fix: `remove 'params', or declare params on the ${use.kind}`,
      pointer: use.paramsPointer,
    });

    return undefined;
  }

  const issues = context.treeSchemas.checkExample(use.params ?? {}, {
    kind: "ref",
    schema: use.schema,
  });

  if (issues.length === 0)
    return use.params === undefined ? {} : { params: pipelineCopy(use.params) };
  reporter.error({
    rule: use.rule,
    message: `the params of ${use.holder} do not fit ${use.schema}, the params of ${target}: ${listedIssues(issues)}`,
    fix: `give params that fit ${use.schema}`,
    pointer: use.params === undefined ? use.usePointer : use.paramsPointer,
  });

  return undefined;
}

// A message lists the first issues, each quoted, and counts the rest.
const LISTED_ISSUES = 3;

function listedIssues(issues: readonly { pointer: string; message: string }[]): string {
  const listed = issues
    .slice(0, LISTED_ISSUES)
    .map((issue) =>
      accessRightsQuoted(`${issue.pointer === "" ? "(params)" : issue.pointer}: ${issue.message}`),
    );
  const more = issues.length - listed.length;

  return more > 0 ? `${listed.join("; ")}; and ${more} more` : listed.join("; ");
}
