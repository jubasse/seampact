import type { IrWriter } from "@seampact/spec/ir";
import { segmentsOf, splitName } from "@seampact/spec/naming";
import { pipelineCopy, pipelineParseDuration } from "../../../pipeline/seam.js";
import {
  type AccessRightsRawObject,
  accessRightsDocs,
  accessRightsEntries,
  accessRightsExtensions,
  accessRightsMember,
  accessRightsPointer,
  accessRightsSchemaName,
  accessRightsString,
  accessRightsStrings,
} from "./read.js";
import type { AccessRightsReporter } from "./report.js";
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

  const rights = new Map<string, IrWriter.Right>();
  const rightIdNames = new Map<string, string>();
  for (const [id, declaration] of accessRightsEntries(merged, "rights")) {
    const right = rightOf(context, reporter, { id, declaration, scopeNames, rightPattern });
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
    declared: {
      rights: namesOf("rights"),
      rules: namesOf("rules"),
      scopes: scopeNames,
      buckets: namesOf("buckets"),
    },
    ...(rightPattern === undefined ? {} : { rightPattern }),
  };
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
}

function rightOf(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  { id, declaration, scopeNames, rightPattern }: RightDeclaration,
): IrWriter.Right | undefined {
  const pointer = accessRightsPointer("/rights", id);
  const codeName = accessRightsString(declaration, "codeName");
  if (!accessRightsCheckName(reporter, { id, codeName, pointer, rightPattern })) return undefined;

  const subject = rightSubjectOf(context, reporter, { id, declaration, scopeNames });
  if (subject === undefined) return undefined;

  const guest = accessRightsString(declaration, "guest");
  const hasParams = accessRightsMember(declaration, "params") !== undefined;
  return {
    id,
    ...(hasParams
      ? { params: accessRightsParamsRef(context, accessRightsPointer(pointer, "params")) }
      : {}),
    subject,
    ...(guest === undefined ? {} : { guest }),
    errors: accessRightsStrings(declaration, "errors"),
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
  const pointer = accessRightsPointer("/rights", id);
  const subject = accessRightsMember(declaration, "subject");
  const scope = accessRightsString(subject, "scope");
  const resource = accessRightsString(subject, "resource");

  if (scope !== undefined) {
    if (scopeNames.has(scope)) return { kind: "scope", scope };
    reporter.error({
      rule: "right-subject",
      message: `the subject of right '${id}' names scope '${scope}', which the scopes catalogue does not declare`,
      fix: "declare the scope in 'scopes', or name a declared one",
      pointer: accessRightsPointer(pointer, "subject", "scope"),
    });
    return undefined;
  }

  if (resource === undefined) return { kind: "none" };
  return {
    kind: "resource",
    type: { segments: splitName(resource), role: "schema" },
    idSchema: accessRightsTypeUse(context, accessRightsPointer(pointer, "subject", "id"), "input"),
  };
}

function ruleOf(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  id: string,
  declaration: AccessRightsRawObject,
): IrWriter.Rule | undefined {
  const pointer = accessRightsPointer("/rules", id);
  const proof = accessRightsMember(declaration, "proof");
  const placement = accessRightsString(proof, "in");
  const proofName = accessRightsString(proof, "name");

  // A proof without a schema has no type: a target could neither read nor check it.
  if (proof !== undefined && accessRightsMember(proof, "schema") === undefined) {
    reporter.error({
      rule: "proof-schema",
      message: `the proof of rule '${id}' declares no schema`,
      fix: "set the proof's 'schema' to the named schema of the value it reads",
      pointer: accessRightsPointer(pointer, "proof"),
    });
    return undefined;
  }

  const hasParams = accessRightsMember(declaration, "params") !== undefined;
  return {
    id,
    ...(hasParams
      ? { params: accessRightsParamsRef(context, accessRightsPointer(pointer, "params")) }
      : {}),
    takesBucket: accessRightsMember(declaration, "bucket") === true,
    ...(placement === undefined || proofName === undefined
      ? {}
      : {
          proof: {
            in: placement === "header" ? "header" : "body",
            name: proofName,
            schema: accessRightsTypeUse(
              context,
              accessRightsPointer(pointer, "proof", "schema"),
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

function scopeOf(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  options: { id: string; declaration: AccessRightsRawObject; scopeNames: ReadonlySet<string> },
): IrWriter.Scope | undefined {
  const { id, declaration, scopeNames } = options;
  const pointer = accessRightsPointer("/scopes", id);
  const within = accessRightsString(declaration, "within");
  if (within !== undefined && !withinChainTerminates(context, reporter, id, scopeNames))
    return undefined;

  return {
    id,
    idSchema: accessRightsTypeUse(context, accessRightsPointer(pointer, "id"), "input"),
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
  const pointer = accessRightsPointer("/scopes", id, "within");
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
        pointer: accessRightsPointer("/scopes", chain[chain.length - 1] ?? id, "within"),
      });
      return false;
    }

    if (chain.includes(parent)) {
      reporter.error({
        rule: "scope-within",
        message: `scope '${id}' is within itself through ${[...chain, parent].join(" -> ")}`,
        fix: "remove the cycle from the scopes' 'within' chain",
        pointer,
      });
      return false;
    }
    chain.push(parent);
  }
  return true;
}

const withinOf = (context: AccessRightsContext, scope: string): string | undefined =>
  accessRightsString(accessRightsMember(context.raw.merged.scopes, scope), "within");

function bucketOf(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  id: string,
  declaration: AccessRightsRawObject,
): IrWriter.Bucket | undefined {
  const pointer = accessRightsPointer("/buckets", id);
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
        pointer: accessRightsPointer(pointer, "key", index),
      });
      return undefined;
    }
    key.push(source);
  }

  const limit = accessRightsMember(declaration, "limit");
  const window = accessRightsString(declaration, "window");
  const windowMs = window === undefined ? undefined : pipelineParseDuration(window);
  if (window !== undefined && windowMs === undefined) {
    reporter.error({
      rule: "bucket-window",
      message: `the window '${window}' of bucket '${id}' is too long to count in milliseconds`,
      fix: "write a shorter window",
      pointer: accessRightsPointer(pointer, "window"),
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

/** The origin of a node of the merged raw tree the half read, copied for the draft. */
export function accessRightsOriginOf(
  context: AccessRightsContext,
  pointer: string,
): IrWriter.Origin {
  const origin = context.origin(pointer);
  if (origin === undefined)
    throw new Error(`access.rights read ${pointer}, which has no origin in the merged raw tree`);
  return pipelineCopy(origin);
}
