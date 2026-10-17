import type { IrWriter } from "@seampact/spec/ir";
import {
  type DraftIR,
  type PassReadonly,
  pipelineCanonical,
  pipelineCopy,
  pipelineIsJsonObject,
  pipelinePointerBelow,
} from "../../../pipeline/seam.js";
import type { AccessRightsCatalogues } from "./catalogues.js";
import { type AccessRightsDeriveEntry, accessRightsExpand, accessRightsSelects } from "./packs.js";
import {
  type AccessRightsRawValue,
  accessRightsEntries,
  accessRightsMember,
  accessRightsOriginOf,
  accessRightsString,
} from "./read.js";
import { type AccessRightsReporter, accessRightsQuoted } from "./report.js";
import type { AccessRightsApi, AccessRightsRoute } from "./routes.js";
import type { AccessRightsContext } from "./schema-use.js";
import { accessRightsSubject } from "./subjects.js";

// The ordered `requires` of an operation (FR-5, ADR 0002 sections 8 and 9): requirements derived by pack entries
// first (packs in application order, entries in written order), then the ancestors' from the root down, then the
// route's own. A `requirements` entry is expanded where it is used, with `entry` naming it. The same requirement
// twice is an error, except that a derived one equal to a written one is dropped and the written one stays.

/** One use of a requirement item on a route, before it is checked. */
interface RequirementUse {
  readonly kind: "right" | "rule";
  readonly target: string;
  /** The item holding `params`, `subject` and `bucket`: the use itself, an entry, or a pack's `require`. */
  readonly item: AccessRightsRawValue;
  readonly itemPointer: string;
  /** Where the requirement applies to the route: its `requires` item, or the pack's `require`. */
  readonly usePointer: string;
  readonly entry?: string;
  readonly origin?: IrWriter.Origin;
  readonly derivedFrom?: IrWriter.DerivedFrom;
}

/** What one route's requirements need besides the catalogues. */
export interface AccessRightsRequiresInput {
  readonly route: AccessRightsRoute;
  readonly scopes: readonly IrWriter.OperationScope[];
  readonly api: AccessRightsApi;
  readonly entries: readonly AccessRightsDeriveEntry[];
  readonly schemas: PassReadonly<DraftIR["schemas"]>;
}

/**
 * Checks requirement items once each, whatever the number of routes they apply to: the target, its params and
 * its bucket. A failed item is remembered as undefined, so its uses add no error.
 */
export interface AccessRightsItemChecks {
  readonly checked: Map<string, { readonly params?: unknown } | undefined>;
}

export const accessRightsItemChecks = (): AccessRightsItemChecks => ({ checked: new Map() });

/** The ordered requirements of a route, each checked; the route's other requirement errors are reported. */
export function accessRightsRequirements(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  checks: AccessRightsItemChecks,
  input: AccessRightsRequiresInput,
): IrWriter.Requirement[] {
  // A route with a failed requirement may have dropped its caller right, so it is not checked for one.
  const errorsBeforeUses = reporter.errors;
  const uses = [...derivedUses(context, reporter, input), ...writtenUses(context, reporter, input)];
  let routeFailed = reporter.errors !== errorsBeforeUses;

  const built: BuiltRequirement[] = [];

  for (const use of uses) {
    const checked = checkItem(context, reporter, catalogues, checks, use);
    const requirement =
      checked === undefined
        ? undefined
        : requirementOf(context, reporter, catalogues, input, use, checked.params);

    if (requirement === undefined) {
      routeFailed = true;
      continue;
    }

    built.push({ use, requirement, key: equalityKey(requirement) });
  }

  const requirements = withoutRepeats(reporter, built);

  if (!routeFailed) checkCallerRight(reporter, catalogues, input, requirements);

  return requirements;
}

/**
 * Checks every entry of the `requirements` catalogue once, used or not: its target, params and bucket. A use of an
 * entry then finds it checked.
 */
export function accessRightsCheckRequirementEntries(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  checks: AccessRightsItemChecks,
): void {
  for (const [name, item] of accessRightsEntries(context.raw.merged, "requirements")) {
    const itemPointer = pipelinePointerBelow("/requirements", name);

    checkItem(context, reporter, catalogues, checks, {
      ...targetOf(item, itemPointer),
      item,
      itemPointer,
      usePointer: itemPointer,
      entry: name,
    });
  }
}

function derivedUses(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  { route, api, entries }: AccessRightsRequiresInput,
): RequirementUse[] {
  const uses: RequirementUse[] = [];

  for (const entry of entries) {
    const require = accessRightsMember(entry.settings, "require");

    if (require === undefined || !accessRightsSelects(context, entry, route, api)) continue;

    const pointer = pipelinePointerBelow(entry.pointer, "require");
    const derivedFrom = {
      derivation: entry.derivation,
      from: [accessRightsOriginOf(context, pointer)],
    };
    const target = derivedTarget(reporter, require, pointer, route);

    if (target === undefined) continue;

    uses.push({ ...target, item: require, itemPointer: pointer, usePointer: pointer, derivedFrom });
  }

  return uses;
}

// A pack's `require` names a rule, or a right template expanded for the route; undefined after an error.
function derivedTarget(
  reporter: AccessRightsReporter,
  require: AccessRightsRawValue,
  pointer: string,
  route: AccessRightsRoute,
): Pick<RequirementUse, "kind" | "target"> | undefined {
  const rule = accessRightsString(require, "rule");

  if (rule !== undefined) return { kind: "rule", target: rule };

  const template = accessRightsString(require, "right");

  if (template === undefined)
    throw new Error(`the pack require at ${pointer} names neither a right nor a rule`);
  const right = accessRightsExpand(
    reporter,
    { text: template, pointer: pipelinePointerBelow(pointer, "right") },
    route,
  );

  return right === undefined ? undefined : { kind: "right", target: right };
}

function writtenUses(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  { route }: AccessRightsRequiresInput,
): RequirementUse[] {
  const uses: RequirementUse[] = [];
  const requirementsCatalogue = accessRightsMember(context.raw.merged, "requirements");

  // The inherited entries flatten each node's list in order, so an item's index counts within its node.
  const indexInNode = new Map<unknown, number>();

  for (const written of context.inherited(route.node, "requires")?.entries ?? []) {
    const index = indexInNode.get(written.node) ?? 0;

    indexInNode.set(written.node, index + 1);
    const usePointer = pipelinePointerBelow(written.node.pointer, "requires", index);
    const origin = pipelineCopy(written.origin);

    if (typeof written.value === "string") {
      const item = accessRightsMember(requirementsCatalogue, written.value);

      if (!pipelineIsJsonObject(item)) {
        reporter.error({
          rule: "requirement-entry",
          message: `'${accessRightsQuoted(written.value)}' names no entry of the requirements catalogue`,
          fix: "declare it under 'requirements', or write the requirement as an item ({ right } or { rule })",
          pointer: usePointer,
        });
        continue;
      }

      const itemPointer = pipelinePointerBelow("/requirements", written.value);

      uses.push({
        ...targetOf(item, itemPointer),
        item,
        itemPointer,
        usePointer,
        entry: written.value,
        origin,
      });
      continue;
    }

    uses.push({
      ...targetOf(written.value, usePointer),
      item: written.value,
      itemPointer: usePointer,
      usePointer,
      origin,
    });
  }

  return uses;
}

// The authoring schema requires an item to name a right or a rule.
function targetOf(
  item: AccessRightsRawValue,
  pointer: string,
): Pick<RequirementUse, "kind" | "target"> {
  const right = accessRightsString(item, "right");

  if (right !== undefined) return { kind: "right", target: right };

  const rule = accessRightsString(item, "rule");

  if (rule === undefined)
    throw new Error(`the requirement item at ${pointer} names neither a right nor a rule`);

  return { kind: "rule", target: rule };
}

// The route-independent checks of an item: its target exists, its params fit, its bucket is allowed and declared.
function checkItem(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  checks: AccessRightsItemChecks,
  use: RequirementUse,
): { readonly params?: unknown } | undefined {
  const key = `${use.itemPointer}\n${use.kind}\n${use.target}`;

  if (checks.checked.has(key)) return checks.checked.get(key);

  const result = checkTargetAndParams(context, reporter, catalogues, use);

  checks.checked.set(key, result);

  return result;
}

function checkTargetAndParams(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  use: RequirementUse,
): { readonly params?: unknown } | undefined {
  const target =
    use.kind === "right" ? catalogues.rights.get(use.target) : catalogues.rules.get(use.target);

  if (target === undefined) {
    const declared = use.kind === "right" ? catalogues.declared.rights : catalogues.declared.rules;

    if (!declared.has(use.target))
      reporter.error({
        rule: "requirement-target",
        message: `the requirement names ${use.kind} '${use.target}', which the ${use.kind}s catalogue does not declare`,
        fix: `declare the ${use.kind} in '${use.kind}s', or name a declared one`,
        pointer: pipelinePointerBelow(use.itemPointer, use.kind),
      });

    return undefined;
  }

  if (
    use.kind === "rule" &&
    !checkBucket(reporter, catalogues, use, catalogues.rules.get(use.target))
  )
    return undefined;

  const params = accessRightsMember(use.item, "params");
  const paramsPointer = pipelinePointerBelow(use.itemPointer, "params");

  if (target.params === undefined) {
    if (params === undefined) return {};
    reporter.error({
      rule: "requirement-params",
      message: `${use.kind} '${use.target}' declares no params, but the requirement gives some`,
      fix: `remove 'params', or declare params on the ${use.kind}`,
      pointer: paramsPointer,
    });

    return undefined;
  }

  const issues = context.treeSchemas.checkExample(params ?? {}, {
    kind: "ref",
    schema: target.params,
  });

  if (issues.length === 0) return params === undefined ? {} : { params: pipelineCopy(params) };
  reporter.error({
    rule: "requirement-params",
    message: `the params of the requirement do not fit ${target.params}, the params of ${use.kind} '${use.target}': ${listedIssues(issues)}`,
    fix: `give params that fit ${target.params}`,
    pointer: params === undefined ? use.itemPointer : paramsPointer,
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

// A rule declared with `bucket: true` takes a declared bucket at each use; any other rule takes none.
function checkBucket(
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  use: RequirementUse,
  rule: IrWriter.Rule | undefined,
): boolean {
  const bucket = accessRightsString(use.item, "bucket");
  const pointer = pipelinePointerBelow(use.itemPointer, "bucket");

  if (rule?.takesBucket !== true) {
    if (bucket === undefined) return true;
    reporter.error({
      rule: "requirement-bucket",
      message: `rule '${use.target}' takes no bucket; only a rule declared with 'bucket: true' does`,
      fix: "remove 'bucket', or declare the rule with 'bucket: true'",
      pointer,
    });

    return false;
  }

  if (bucket === undefined) {
    reporter.error({
      rule: "requirement-bucket",
      message: `rule '${use.target}' is declared with 'bucket: true', so each use names a bucket`,
      fix: "name a declared bucket in the requirement's 'bucket'",
      pointer: use.itemPointer,
    });

    return false;
  }

  if (catalogues.buckets.has(bucket)) return true;

  if (!catalogues.declared.buckets.has(bucket))
    reporter.error({
      rule: "requirement-bucket",
      message: `the requirement counts in bucket '${bucket}', which the buckets catalogue does not declare`,
      fix: "declare the bucket in 'buckets', or name a declared one",
      pointer,
    });

  return false;
}

// The route-dependent part: a right's subject and the guest rule (CHK-087).
function requirementOf(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  input: AccessRightsRequiresInput,
  use: RequirementUse,
  params: unknown,
): IrWriter.Requirement | undefined {
  const common = {
    ...(params === undefined ? {} : { params: pipelineCopy(params) }),
    ...(use.entry === undefined ? {} : { entry: use.entry }),
    ...(use.origin === undefined ? {} : { origin: use.origin }),
    ...(use.derivedFrom === undefined ? {} : { derivedFrom: pipelineCopy(use.derivedFrom) }),
  };

  if (use.kind === "rule") {
    const bucket = accessRightsString(use.item, "bucket");

    return {
      kind: "rule",
      rule: use.target,
      ...common,
      ...(bucket === undefined ? {} : { bucket }),
    };
  }

  const right = catalogues.rights.get(use.target);

  if (right === undefined) return undefined;

  if (!checkGuest(reporter, input.route, right, use)) return undefined;

  const subjectText = accessRightsString(use.item, "subject");
  const resolved = accessRightsSubject(context, reporter, {
    route: input.route,
    right,
    idName: catalogues.rightIdNames.get(right.id),
    scopes: input.scopes,
    scopeRefused: right.subject.kind === "scope" && !catalogues.scopes.has(right.subject.scope),
    schemas: input.schemas,
    ...(subjectText === undefined
      ? {}
      : {
          written: { text: subjectText, pointer: pipelinePointerBelow(use.itemPointer, "subject") },
        }),
    usePointer: use.usePointer,
  });

  if (resolved === undefined) return undefined;

  return {
    kind: "right",
    right: right.id,
    ...common,
    ...(resolved.subject === undefined ? {} : { subject: resolved.subject }),
  };
}

// A right reaches an anonymous caller on a public or optional-auth route only when it is guest-enabled (SCN-063).
function checkGuest(
  reporter: AccessRightsReporter,
  route: AccessRightsRoute,
  right: IrWriter.Right,
  use: RequirementUse,
): boolean {
  if (route.access === "identity" || right.guest !== undefined) return true;

  // A pack derived the right or the requirement: the author changes the entry's selector or declares the right.
  const derived = right.derivedFrom !== undefined || use.derivedFrom !== undefined;

  reporter.error({
    rule: "guest-right",
    message: `right '${right.id}' is required on ${route.access === "public" ? "public" : "optional-auth"} route '${route.id}', where an anonymous caller reaches it, and the right has no 'guest' reason`,
    fix: derived
      ? "narrow the entry's 'select' to identified routes, or declare the right in 'rights' with a 'guest' reason"
      : "set the right's 'guest' to the reason an anonymous caller may reach it, or require it on an identified route",
    pointer: use.usePointer,
    related:
      route.accessPointer === undefined
        ? []
        : [{ pointer: route.accessPointer, message: "the route's access is set here" }],
  });

  return false;
}

// Two requirements are the same when they name the same right or rule with equal params, bucket and subject; no
// params and empty params are equal, as both are checked as `{}`.
function equalityKey(requirement: IrWriter.Requirement): string {
  return pipelineCanonical([
    requirement.kind,
    requirement.kind === "right" ? requirement.right : requirement.rule,
    requirement.params ?? {},
    requirement.kind === "rule" ? (requirement.bucket ?? null) : null,
    requirement.kind === "right" ? (requirement.subject?.source ?? null) : null,
  ]);
}

interface BuiltRequirement {
  readonly use: RequirementUse;
  readonly requirement: IrWriter.Requirement;
  readonly key: string;
}

function withoutRepeats(
  reporter: AccessRightsReporter,
  built: readonly BuiltRequirement[],
): IrWriter.Requirement[] {
  const writtenKeys = new Set(
    built.filter(({ use }) => use.derivedFrom === undefined).map(({ key }) => key),
  );
  const kept: BuiltRequirement[] = [];

  for (const candidate of built) {
    const derived = candidate.use.derivedFrom !== undefined;

    if (derived && writtenKeys.has(candidate.key)) continue;

    const earlier = kept.find(({ key }) => key === candidate.key);

    if (earlier === undefined) {
      kept.push(candidate);
      continue;
    }

    reporter.error({
      rule: "requirement-twice",
      message: `the route requires ${candidate.requirement.kind} '${candidate.requirement.kind === "right" ? candidate.requirement.right : candidate.requirement.rule}' twice with equal params`,
      fix: "remove one of the two requirements",
      pointer: candidate.use.usePointer,
      related: [{ pointer: earlier.use.usePointer, message: "first required here" }],
    });
  }

  return kept.map(({ requirement }) => requirement);
}

// Every route of a service api requires the api's caller right (ADR 0002 section 5, FR-8). A caller right whose
// declaration is refused already has its error.
function checkCallerRight(
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  { route, api }: AccessRightsRequiresInput,
  requirements: readonly IrWriter.Requirement[],
): void {
  const caller = api.caller;

  if (api.kind !== "service" || caller === undefined) return;

  if (!catalogues.rights.has(caller.right) && catalogues.declared.rights.has(caller.right)) return;

  if (
    requirements.some(
      (requirement) => requirement.kind === "right" && requirement.right === caller.right,
    )
  )
    return;

  reporter.error({
    rule: "caller-right",
    message: `route '${route.id}' of the service api does not require the caller right '${caller.right}'`,
    fix: `add { right: ${caller.right} } to the route's requires or an ancestor's`,
    pointer: route.node.pointer,
    related: [{ pointer: "/api/caller/right", message: "the caller right is set here" }],
  });
}
