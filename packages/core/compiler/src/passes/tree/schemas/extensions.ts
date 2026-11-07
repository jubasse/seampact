import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy, type TreeNode } from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";
import type { TreeSchemasCompiler } from "./compile.js";
import {
  type TreeSchemasRawObject,
  type TreeSchemasReporter,
  treeSchemasEntries,
  treeSchemasIsObject,
  treeSchemasMember,
  treeSchemasPointer,
} from "./raw.js";

// Consumer extension keys (ADR 0002 section 12, FR-10): each declared under a prefix with a schema and the places
// it may sit, written `x-<prefix>-<key>` there. Every written value is parsed against its declaration's schema like
// an example; an undeclared key, or one outside its places, is refused at the key.

/** A mapping holding written extension values, and the place of the IR element they extend. */
export interface TreeSchemasExtensionHolder {
  pointer: string;
  value: TreeSchemasRawObject;
  /** None for a schema mapping that writes no IR element (an inlined scalar, array or enum use). */
  place: IrWriter.ExtensionPlace | undefined;
}

// `x-<prefix>-<key>`: the prefix holds no dash, so the key is everything after it.
const EXTENSION_KEY = /^x-([a-z][a-z0-9]*)-(.+)$/;

const PLACES: ReadonlySet<string> = new Set<IrWriter.ExtensionPlace>([
  "api",
  "operation",
  "schema",
  "property",
  "right",
  "rule",
  "scope",
]);

const isPlace = (value: unknown): value is IrWriter.ExtensionPlace =>
  typeof value === "string" && PLACES.has(value);

/** Whether a mapping writes any extension key. */
export const treeSchemasHasExtensions = (value: TreeSchemasRawObject): boolean =>
  Object.keys(value).some((key) => EXTENSION_KEY.test(key));

/**
 * The IR slot `{ <prefix>: { <key>: value } }` of the extension values a mapping writes, each copied. The key may
 * be `__proto__`, so the slot is built with `Object.fromEntries`, which defines own members only.
 */
export function treeSchemasExtensionSlot(value: TreeSchemasRawObject): IrWriter.Extensions {
  const slot = new Map<string, [string, unknown][]>();

  for (const [written, member] of Object.entries(value)) {
    const [, prefix, key] = EXTENSION_KEY.exec(written) ?? [];

    if (prefix === undefined || key === undefined) continue;
    slot.set(prefix, [...(slot.get(prefix) ?? []), [key, pipelineCopy(member)]]);
  }

  return Object.fromEntries([...slot].map(([prefix, keys]) => [prefix, Object.fromEntries(keys)]));
}

/** Compiles the `extensions` catalogue into its declarations, each schema a position no use reads. */
export function treeSchemasCompileExtensionKeys(
  compiler: TreeSchemasCompiler,
  merged: TreeSchemasRawObject,
): IrWriter.ExtensionKeyDecl[] {
  const declarations: IrWriter.ExtensionKeyDecl[] = [];

  for (const [prefix, keys] of treeSchemasEntries(merged.extensions)) {
    for (const [key, declaration] of treeSchemasEntries(keys)) {
      const pointer = treeSchemasPointer("/extensions", prefix, key);
      const schemaPointer = treeSchemasPointer(pointer, "schema");
      const schema = treeSchemasMember(declaration, "schema");
      const at = treeSchemasMember(declaration, "at");

      if (schema === undefined) continue;
      compiler.position(schema, { pointer: schemaPointer, name: undefined, place: "position" }, []);
      const use = compiler.uses.get(schemaPointer);

      if (use === undefined) continue;
      declarations.push({
        id: `${prefix}-${key}`,
        prefix,
        key,
        schema: structuredClone(use),
        places: Array.isArray(at) ? at.filter(isPlace) : [],
        origin: compiler.reporter.origin(pointer),
      });
    }
  }

  return declarations;
}

// The mappings outside the schemas that hold extension values: the api, every tree node, rights, rules, scopes.
function catalogueHolders(
  merged: TreeSchemasRawObject,
  nodes: readonly TreeNode[],
): TreeSchemasExtensionHolder[] {
  const api = treeSchemasMember(merged, "api");
  const entries = (catalogue: string, place: IrWriter.ExtensionPlace) =>
    treeSchemasEntries(merged[catalogue]).flatMap(([id, value]) =>
      treeSchemasIsObject(value)
        ? [{ pointer: treeSchemasPointer(`/${catalogue}`, id), value, place }]
        : [],
    );

  return [
    ...(treeSchemasIsObject(api) ? [{ pointer: "/api", value: api, place: "api" as const }] : []),
    ...nodes.map((node) => ({
      pointer: node.pointer,
      value: node.settings,
      place: "operation" as const,
    })),
    ...entries("rights", "right"),
    ...entries("rules", "rule"),
    ...entries("scopes", "scope"),
  ];
}

const placesText = (places: readonly IrWriter.ExtensionPlace[]): string =>
  places.length === 0 ? "no place" : places.join(", ");

/**
 * Checks every written extension value: the schema and property holders the compiler met, and the api, tree
 * nodes, rights, rules and scopes. A declared key at one of its places is queued to be parsed against its schema.
 */
export function treeSchemasCheckExtensionValues(
  compiler: TreeSchemasCompiler,
  declarations: readonly IrWriter.ExtensionKeyDecl[],
  context: { merged: TreeSchemasRawObject; nodes: readonly TreeNode[] },
  reporter: TreeSchemasReporter,
): void {
  const byKey = new Map(declarations.map((declared) => [`x-${declared.id}`, declared]));
  const holders = [
    ...catalogueHolders(context.merged, context.nodes),
    ...compiler.extensionHolders.values(),
  ];

  for (const { pointer, value, place } of holders) {
    for (const [key, written] of Object.entries(value)) {
      if (!EXTENSION_KEY.test(key)) continue;
      const at = treeSchemasPointer(pointer, key);
      const declared = byKey.get(key);

      if (declared === undefined) {
        reporter.error({
          rule: "extension-unknown",
          pointer: at,
          message: `${quote(key)} is no declared extension key`,
          fix: "declare it under 'extensions' with its schema and places, or remove it",
        });
        continue;
      }

      if (place === undefined || !declared.places.includes(place)) {
        reporter.error({
          rule: "extension-place",
          pointer: at,
          message:
            place === undefined
              ? `${quote(key)} may sit on ${placesText(declared.places)}, and this mapping is no place an extension extends`
              : `${quote(key)} may sit on ${placesText(declared.places)}, not on ${place}`,
          fix:
            place === undefined
              ? "move it to a place its 'at' lists, or remove it"
              : `add '${place}' to its 'at', or move it`,
          related: [
            {
              pointer: treeSchemasPointer("/extensions", declared.prefix, declared.key),
              message: "its declaration",
            },
          ],
        });
        continue;
      }

      compiler.exampleChecks.push({
        pointer: at,
        value: pipelineCopy(written),
        use: structuredClone(declared.schema),
        written: "extension",
      });
    }
  }
}
