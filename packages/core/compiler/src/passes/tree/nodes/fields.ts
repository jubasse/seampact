import type { IrWriter, Origin } from "@seampact/spec/ir";
import { type DraftIR, pipelineCopy, type TreeNode } from "../../../pipeline/seam.js";
import {
  type TreeNodesReportOnce,
  treeNodesError,
  treeNodesLocate,
  treeNodesNodeOrigin,
} from "./diagnostics.js";
import {
  type TreeNodesContext,
  type TreeNodesJson,
  treeNodesAnsweredUse,
  treeNodesIsObject,
  treeNodesMember,
  treeNodesObjectOf,
  treeNodesPointer,
} from "./raw.js";

// Fields maps (ADR 0002 section 4): `id`, `pathParams`, `query`, `headers` and response `headers` map a name to a
// schema, a field being required unless its name ends with `?`; a string instead names an object schema whose
// properties are the fields. Also the check every parameter and header shares: no opaque value or file (ADR 0003
// section 2).

/** One operation being written, with what its parts read and report through. */
export interface TreeNodesSite {
  readonly node: TreeNode;
  readonly operationId: string;
  readonly draft: DraftIR;
  readonly context: TreeNodesContext;
  readonly once: TreeNodesReportOnce;
}

/** One field of a fields map. */
export interface TreeNodesField {
  readonly name: string;
  readonly required: boolean;
  readonly type: IrWriter.TypeUse;
  /** The `default` written on the field or its property (ADR 0003 section 10), absent when none is. */
  readonly default?: unknown;
  readonly origin: Origin;
  /** Where the schema service answers the field's query wire. */
  readonly wirePointer: string;
}

/** The fields of a map, and whether every name is known (a schema name that is no object schema is not). */
export interface TreeNodesFields {
  readonly fields: readonly TreeNodesField[];
  readonly complete: boolean;
}

const OPTIONAL_SUFFIX = "?";
const DEFAULT_KEY = "default";

/** The fields of the map written at `pointer`, each schema compiled in `direction`. */
export function treeNodesFields(
  site: TreeNodesSite,
  written: TreeNodesJson | undefined,
  pointer: string,
  direction: IrWriter.Direction,
): TreeNodesFields {
  if (typeof written === "string") return namedSchemaFields(site, written, pointer, direction);

  if (!treeNodesIsObject(written)) return { fields: [], complete: true };

  const fields = Object.keys(written).map((key): TreeNodesField => {
    const fieldPointer = treeNodesPointer(pointer, key);
    const optional = key.endsWith(OPTIONAL_SUFFIX);

    const writtenDefault = treeNodesMember(treeNodesMember(written, key), DEFAULT_KEY);

    return {
      name: optional ? key.slice(0, -OPTIONAL_SUFFIX.length) : key,
      required: !optional,
      type: treeNodesAnsweredUse(site.context, fieldPointer, direction),
      ...(writtenDefault === undefined ? {} : { default: pipelineCopy(writtenDefault) }),
      origin: site.context.origin(fieldPointer) ?? site.node.origin,
      wirePointer: fieldPointer,
    };
  });

  return { fields, complete: true };
}

// `query: TaskQuery`: the properties of the named object schema, each asked for its wire at its position there.
function namedSchemaFields(
  site: TreeNodesSite,
  schemaName: string,
  pointer: string,
  direction: IrWriter.Direction,
): TreeNodesFields {
  const use = treeNodesAnsweredUse(site.context, pointer, direction);
  const schema = treeNodesObjectOf(site.draft, use);

  if (schema === undefined) {
    const origin = treeNodesNodeOrigin(site.context.origin(pointer) ?? site.node.origin);

    site.once(
      `fields-schema:${pointer}`,
      treeNodesError({
        rule: "fields-schema",
        origin,
        message: `The fields at ${pointer} name ${schemaName}, which is not an object schema, so it has no fields.`,
        fix: "Name an object schema, or write the fields as a map.",
      }),
    );

    return { fields: [], complete: false };
  }

  const schemaPointer = treeNodesPointer("/schemas", schema.id);
  const fields = schema.properties.map(
    (property): TreeNodesField => ({
      name: property.name,
      required: !property.optional,
      type: property.type,
      ...(property.default === undefined ? {} : { default: property.default }),
      origin: property.origin,
      wirePointer: treeNodesPointer(schemaPointer, "properties", property.name),
    }),
  );

  return { fields, complete: true };
}

// ADR 0003 section 2: an opaque value and a file never sit in a query, a path parameter or a header, nor do their
// lists.
const TEXTLESS_KINDS: Partial<Record<IrWriter.TypeUse["kind"], string>> = {
  opaque: "an opaque value",
  file: "a file",
};

/**
 * Whether a field may travel in a parameter or a header: an opaque value or a file, or a list of them, has no text
 * form (ADR 0003 section 2). Reports the field otherwise. A header-tagged union there is tree.schemas'
 * `union-header`.
 */
export function treeNodesFieldTravels(
  site: TreeNodesSite,
  field: TreeNodesField,
  place: string,
): boolean {
  const origin = treeNodesLocate(field.origin, treeNodesNodeOrigin(site.node.origin));
  const key = `${origin.layer}#${origin.pointer}:${field.name}`;

  const innermost = treeNodesInnermost(field.type);
  const textless = innermost === undefined ? undefined : TEXTLESS_KINDS[innermost.kind];

  if (textless !== undefined) {
    site.once(
      `opaque-position:${key}`,
      treeNodesError({
        rule: "opaque-position",
        origin,
        message: `The ${place} ${field.name} of ${site.operationId} is ${textless}, which has no text form.`,
        fix: "Give it a schema with a text form, or move it into the body.",
      }),
    );

    return false;
  }

  return true;
}

/** The innermost item of a list use: a list of files is still a file in an item position. */
export function treeNodesInnermost(
  use: IrWriter.TypeUse | undefined,
): IrWriter.TypeUse | undefined {
  let at = use;

  while (at?.kind === "array") at = at.items;

  return at;
}
