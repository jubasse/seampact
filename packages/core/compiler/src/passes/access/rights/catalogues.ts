import type { IrWriter } from "@seampact/spec/ir";
import { segmentsOf, splitName } from "@seampact/spec/naming";
import { pipelineParseDuration, pipelinePointerBelow } from "../../../pipeline/seam.js";
import {
  type AccessRightsRawObject,
  type AccessRightsRawValue,
  accessRightsDocs,
  accessRightsEntries,
  accessRightsExtensions,
  accessRightsMember,
  accessRightsOriginOf,
  accessRightsSchemaName,
  accessRightsString,
  accessRightsStrings,
} from "./read.js";
import { type AccessRightsReporter, accessRightsQuoted } from "./report.js";
import {
  type AccessRightsContext,
  accessRightsParamsRef,
  accessRightsTypeUse,
} from "./schema-use.js";
import { accessRightsSourceText, accessRightsValueSource } from "./source.js";

// The `rights`, `rules`, `scopes` and `buckets` catalogues (ADR 0002 section 9, ADR 0004 section 4). Each entry is
// built from its declaration; one with an error is left out, so a requirement naming it reports nothing more.

/** The catalogues this half builds, by id, before it writes them. */
export interface AccessRightsCatalogues {
  readonly rights: Map<string, IrWriter.Right>;
  readonly rules: Map<string, IrWriter.Rule>;
  readonly scopes: Map<string, IrWriter.Scope>;
  readonly buckets: Map<string, IrWriter.Bucket>;
  /** The schema each resource right's id names (`TaskId`), when it names one; pack-derived rights add theirs. */
  readonly rightIdNames: Map<string, string>;
  /**
   * The names declared in each catalogue, refused ones included, so a use of a refused one adds no error. A
   * pack-derived right that is refused adds its name too.
   */
  readonly declared: {
    readonly rights: Set<string>;
    readonly rules: ReadonlySet<string>;
    readonly scopes: ReadonlySet<string>;
    readonly buckets: ReadonlySet<string>;
  };
  /** The code of the `forbidden` role, which a right without written `errors` answers (ADR 0002 section 9). */
  readonly forbiddenCode: string;
  /** `conventions.rights.pattern`, compiled, with its pointer; undefined when not written. */
  readonly rightPattern?: { readonly pattern: RegExp; readonly pointer: string };
}

// The largest prefix an address bucket key may count (an IPv6 address).
const ADDRESS_BITS = 128;

const RIGHT_PATTERN_POINTER = "/conventions/rights/pattern";

/** Builds the four catalogues, reporting each declaration's errors. */
export function accessRightsCatalogues(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
): AccessRightsCatalogues {
  const merged = context.raw.merged;
  const scopeNames = new Set(Object.keys(accessRightsMember(merged, "scopes") ?? {}));
  const rightPattern = rightPatternOf(context, reporter);
  const forbiddenCode = forbiddenCodeOf(context);

  const rights = new Map<string, IrWriter.Right>();
  const rightIdNames = new Map<string, string>();

  for (const [id, declaration] of accessRightsEntries(merged, "rights")) {
    const right = rightOf(context, reporter, {
      id,
      declaration,
      scopeNames,
      rightPattern,
      forbiddenCode,
    });

    if (right === undefined) continue;

    rights.set(id, right);
    const idName = accessRightsSchemaName(
      accessRightsMember(accessRightsMember(declaration, "subject"), "id"),
    );

    if (idName !== undefined) rightIdNames.set(id, idName);
  }

  const rules = new Map<string, IrWriter.Rule>();

  for (const [id, declaration] of accessRightsEntries(merged, "rules")) {
    const rule = ruleOf(context, reporter, id, declaration);

    if (rule !== undefined) rules.set(id, rule);
  }

  const scopes = new Map<string, IrWriter.Scope>();

  for (const [id, declaration] of accessRightsEntries(merged, "scopes")) {
    const scope = scopeOf(context, reporter, { id, declaration, scopeNames });

    if (scope !== undefined) scopes.set(id, scope);
  }

  const buckets = new Map<string, IrWriter.Bucket>();

  for (const [id, declaration] of accessRightsEntries(merged, "buckets")) {
    const bucket = bucketOf(context, reporter, id, declaration);

    if (bucket !== undefined) buckets.set(id, bucket);
  }

  const namesOf = (catalogue: string) =>
    new Set(Object.keys(accessRightsMember(merged, catalogue) ?? {}));

  return {
    rights,
    rules,
    scopes,
    buckets,
    rightIdNames,
    forbiddenCode,
    declared: {
      rights: namesOf("rights"),
      rules: namesOf("rules"),
      scopes: scopeNames,
      buckets: namesOf("buckets"),
    },
    ...(rightPattern === undefined ? {} : { rightPattern }),
  };
}

// The role binding is a code, or `{ code, params }` (ADR 0002 section 11); the core binds every role by default.
function forbiddenCodeOf(context: AccessRightsContext): string {
  const binding = context.conventions.get("errors.derived.forbidden")?.value;
  const code = typeof binding === "string" ? binding : accessRightsString(binding, "code");

  if (code === undefined)
    throw new Error(
      `conventions.errors.derived.forbidden binds no code: ${JSON.stringify(binding)}`,
    );

  return code;
}

/** A right's `errors` as written, else the code of the `forbidden` role. */
export function accessRightsRightErrors(
  declaration: AccessRightsRawValue | undefined,
  forbiddenCode: string,
): string[] {
  if (accessRightsMember(declaration, "errors") === undefined) return [forbiddenCode];

  return accessRightsStrings(declaration, "errors");
}

function rightPatternOf(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
): AccessRightsCatalogues["rightPattern"] {
  const written = context.conventions.get("rights.pattern")?.value;

  if (typeof written !== "string") return undefined;

  try {
    return { pattern: new RegExp(written, "u"), pointer: RIGHT_PATTERN_POINTER };
  } catch (error) {
    reporter.error({
      rule: "right-pattern",
      message: `conventions.rights.pattern '${written}' is no regular expression: ${String(error)}`,
      fix: "write a regular expression every right name must match",
      pointer: RIGHT_PATTERN_POINTER,
    });

    return undefined;
  }
}

/**
 * Checks a right name, declared or derived, against the naming rules (ADR 0002 section 4, ADR 0007 section 2):
 * `conventions.rights.pattern` when written, and an identifier segment or a `codeName`. True when it passes.
 */
export function accessRightsCheckName(
  reporter: AccessRightsReporter,
  options: {
    id: string;
    codeName: string | undefined;
    pointer: string;
    rightPattern: AccessRightsCatalogues["rightPattern"];
  },
): boolean {
  const { id, codeName, pointer, rightPattern } = options;
  let passes = true;

  if (rightPattern !== undefined && !rightPattern.pattern.test(id)) {
    reporter.error({
      rule: "right-pattern",
      message: `right '${id}' does not match conventions.rights.pattern '${rightPattern.pattern.source}'`,
      fix: "rename the right to match the pattern, or change the pattern",
      pointer,
      related: [{ pointer: rightPattern.pointer, message: "the pattern is set here" }],
    });
    passes = false;
  }

  if (!segmentsOf(id, "right", codeName === undefined ? {} : { codeName }).ok) {
    reporter.error({
      rule: "right-name",
      message:
        codeName === undefined
          ? `right '${id}' yields no identifier segment for generated code`
          : `the codeName '${codeName}' of right '${id}' yields no identifier segment`,
      fix: "set the right's codeName to a name with letters or digits",
      pointer,
    });
    passes = false;
  }

  return passes;
}

interface RightDeclaration {
  id: string;
  declaration: AccessRightsRawObject;
  scopeNames: ReadonlySet<string>;
  rightPattern: AccessRightsCatalogues["rightPattern"];
  forbiddenCode: string;
}

function rightOf(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  { id, declaration, scopeNames, rightPattern, forbiddenCode }: RightDeclaration,
): IrWriter.Right | undefined {
  const pointer = pipelinePointerBelow("/rights", id);
  const codeName = accessRightsString(declaration, "codeName");

  if (!accessRightsCheckName(reporter, { id, codeName, pointer, rightPattern })) return undefined;

  const subject = rightSubjectOf(context, reporter, { id, declaration, scopeNames });

  if (subject === undefined) return undefined;

  const guest = accessRightsString(declaration, "guest");
  const hasParams = accessRightsMember(declaration, "params") !== undefined;

  return {
    id,
    ...(hasParams
      ? { params: accessRightsParamsRef(context, pipelinePointerBelow(pointer, "params")) }
      : {}),
    subject,
    ...(guest === undefined ? {} : { guest }),
    errors: accessRightsRightErrors(declaration, forbiddenCode),
    docs: accessRightsDocs(declaration),
    extensions: accessRightsExtensions(declaration),
    origin: accessRightsOriginOf(context, pointer),
    ...(codeName === undefined
      ? {}
      : { codeName: { segments: splitName(codeName), role: "schema" } }),
  };
}

function rightSubjectOf(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  options: { id: string; declaration: AccessRightsRawObject; scopeNames: ReadonlySet<string> },
): IrWriter.RightSubject | undefined {
  const { id, declaration, scopeNames } = options;
  const pointer = pipelinePointerBelow("/rights", id);
  const subject = accessRightsMember(declaration, "subject");
  const scope = accessRightsString(subject, "scope");
  const resource = accessRightsString(subject, "resource");

  if (scope !== undefined) {
    if (scopeNames.has(scope)) return { kind: "scope", scope };
    reporter.error({
      rule: "right-subject",
      message: `the subject of right '${id}' names scope '${scope}', which the scopes catalogue does not declare`,
      fix: "declare the scope in 'scopes', or name a declared one",
      pointer: pipelinePointerBelow(pointer, "subject", "scope"),
    });

    return undefined;
  }

  if (resource === undefined) return { kind: "none" };

  return {
    kind: "resource",
    type: { segments: splitName(resource), role: "schema" },
    idSchema: accessRightsTypeUse(context, pipelinePointerBelow(pointer, "subject", "id"), "input"),
  };
}

function ruleOf(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  id: string,
  declaration: AccessRightsRawObject,
): IrWriter.Rule | undefined {
  const pointer = pipelinePointerBelow("/rules", id);
  const proof = accessRightsMember(declaration, "proof");
  const placement = accessRightsString(proof, "in");
  const proofName = accessRightsString(proof, "name");

  // A proof without a schema has no type: a target could neither read nor check it.
  if (proof !== undefined && accessRightsMember(proof, "schema") === undefined) {
    reporter.error({
      rule: "proof-schema",
      message: `the proof of rule '${id}' declares no schema`,
      fix: "set the proof's 'schema' to the named schema of the value it reads",
      pointer: pipelinePointerBelow(pointer, "proof"),
    });

    return undefined;
  }

  const hasParams = accessRightsMember(declaration, "params") !== undefined;

  return {
    id,
    ...(hasParams
      ? { params: accessRightsParamsRef(context, pipelinePointerBelow(pointer, "params")) }
      : {}),
    takesBucket: accessRightsMember(declaration, "bucket") === true,
    ...(placement === undefined || proofName === undefined
      ? {}
      : {
          proof: {
            in: proofPlacement(placement, pointer),
            name: proofName,
            schema: accessRightsTypeUse(
              context,
              pipelinePointerBelow(pointer, "proof", "schema"),
              "input",
            ),
          },
        }),
    errors: accessRightsStrings(declaration, "errors"),
    docs: accessRightsDocs(declaration),
    extensions: accessRightsExtensions(declaration),
    origin: accessRightsOriginOf(context, pointer),
  };
}

const PROOF_PLACEMENTS = ["header", "body"] as const;

// The authoring schema allows a proof in a header or the body only.
function proofPlacement(placement: string, pointer: string): IrWriter.ProofPlacement {
  const known = PROOF_PLACEMENTS.find((candidate) => candidate === placement);

  if (known === undefined)
    throw new Error(
      `the proof of the rule at ${pointer} is in '${placement}', neither header nor body`,
    );

  return known;
}

function scopeOf(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  options: { id: string; declaration: AccessRightsRawObject; scopeNames: ReadonlySet<string> },
): IrWriter.Scope | undefined {
  const { id, declaration, scopeNames } = options;
  const pointer = pipelinePointerBelow("/scopes", id);
  const within = accessRightsString(declaration, "within");

  if (within !== undefined && !withinChainTerminates(context, reporter, id, scopeNames))
    return undefined;

  return {
    id,
    idSchema: accessRightsTypeUse(context, pipelinePointerBelow(pointer, "id"), "input"),
    ...(within === undefined ? {} : { within }),
    errors: accessRightsStrings(declaration, "errors"),
    docs: accessRightsDocs(declaration),
    extensions: accessRightsExtensions(declaration),
    origin: accessRightsOriginOf(context, pointer),
  };
}

// Follows `within` from a scope up to a root scope: each parent must be declared, and the chain never cycles.
function withinChainTerminates(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  id: string,
  scopeNames: ReadonlySet<string>,
): boolean {
  const chain = [id];

  for (
    let parent = withinOf(context, id);
    parent !== undefined;
    parent = withinOf(context, parent)
  ) {
    if (!scopeNames.has(parent)) {
      reporter.error({
        rule: "scope-within",
        message: `scope '${chain[chain.length - 1]}' is within '${parent}', which the scopes catalogue does not declare`,
        fix: "declare the parent scope, or name a declared one in 'within'",
        pointer: pipelinePointerBelow("/scopes", chain[chain.length - 1] ?? id, "within"),
      });

      return false;
    }

    if (chain.includes(parent)) {
      reportWithinCycle(reporter, chain.slice(chain.indexOf(parent)));

      return false;
    }

    chain.push(parent);
  }

  return true;
}

// A cycle is reported once, at its first scope by name, whatever scope's chain reached it.
function reportWithinCycle(reporter: AccessRightsReporter, cycle: readonly string[]): void {
  const [first] = [...cycle].sort();

  if (first === undefined) throw new Error("access.rights found an empty 'within' cycle");

  const start = cycle.indexOf(first);
  const path = [...cycle.slice(start), ...cycle.slice(0, start), first];

  reporter.error({
    rule: "scope-within",
    message: `scope '${first}' is within itself through ${path.join(" -> ")}`,
    fix: "remove the cycle from the scopes' 'within' chain",
    pointer: pipelinePointerBelow("/scopes", first, "within"),
  });
}

const withinOf = (context: AccessRightsContext, scope: string): string | undefined =>
  accessRightsString(accessRightsMember(context.raw.merged.scopes, scope), "within");

function bucketOf(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  id: string,
  declaration: AccessRightsRawObject,
): IrWriter.Bucket | undefined {
  const pointer = pipelinePointerBelow("/buckets", id);
  const key: IrWriter.ValueSource[] = [];

  for (const [index, text] of accessRightsStrings(declaration, "key").entries()) {
    const source = accessRightsValueSource(text);

    if (source === undefined)
      throw new Error(`the bucket key '${text}' at ${pointer} is outside the grammar's forms`);

    if (source.prefixBits !== undefined && source.prefixBits > ADDRESS_BITS) {
      reporter.error({
        rule: "bucket-key",
        message: `bucket '${id}' counts ${accessRightsSourceText(source)}, a prefix longer than ${ADDRESS_BITS} bits`,
        fix: `count a prefix of at most ${ADDRESS_BITS} bits`,
        pointer: pipelinePointerBelow(pointer, "key", index),
      });

      return undefined;
    }

    key.push(source);
  }

  const limit = accessRightsMember(declaration, "limit");

  if (limit !== undefined && typeof limit !== "number")
    throw new Error(`the limit of the bucket at ${pointer} is no number`);
  const window = accessRightsString(declaration, "window");
  const windowMs = window === undefined ? undefined : pipelineParseDuration(window);

  if (window !== undefined && windowMs === undefined) {
    reporter.error({
      rule: "bucket-window",
      message: `the window '${accessRightsQuoted(window)}' of bucket '${id}' is too long to count in milliseconds`,
      fix: "write a shorter window",
      pointer: pipelinePointerBelow(pointer, "window"),
    });

    return undefined;
  }

  return {
    id,
    key,
    ...(typeof limit === "number" ? { limit } : {}),
    ...(windowMs === undefined ? {} : { windowMs }),
    origin: accessRightsOriginOf(context, pointer),
  };
}
