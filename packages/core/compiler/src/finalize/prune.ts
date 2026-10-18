import {
  IR_SCHEMA_DOCUMENTS,
  IR_SCHEMA_ID,
  type SchemaNode,
  walkIrInstance,
} from "@seampact/spec/ir";
import { pointerSegments } from "../load/paths.js";
import type { DraftIR } from "../pipeline/seam.js";
import { finalizeIsRecord as isRecord } from "./record.js";

// The pruning of finalize (ADR 0004 section 2): only the declarations reachable from an operation, an identity or
// a convention stay in the IR, core declarations included. A declaration is reached through a member that holds
// its id (a `SchemaId`, an `ErrorCode`...), through an extension value written under its prefix and key, or
// through a core origin that points at it (a params schema's origin names its code). References are followed to a
// fixed point, so a code, then its params schema, then the issue schema those params name are kept together.
// Convention values are opaque JSON, so a convention reaches no declaration at this irRevision.

/** One catalogue entry: its top-level member (`schemas`) and its key. */
interface FinalizeCatalogueEntry {
  readonly member: string;
  readonly id: string;
}

// The catalogues identities live in: every identity is kept, as a root of the reachability.
const ROOT_CATALOGUES: readonly string[] = ["identities"];
const EXTENSION_KEYS_MEMBER = "extensionKeys";
const CORE_LAYER = "core";

// The catalogue member of each id definition, read from the ContractIR schema: every top-level map whose keys are
// a `$ref` to an id definition (`schemas` keyed by `SchemaId`).
function readCatalogueMembers(): ReadonlyMap<string, string> {
  const document = IR_SCHEMA_DOCUMENTS.find((candidate) => candidate.$id === IR_SCHEMA_ID);
  const definitions = document?.$defs as Record<string, SchemaNode> | undefined;
  const properties = definitions?.ContractIR?.properties as Record<string, SchemaNode> | undefined;

  if (properties === undefined) throw new Error("finalize found no ContractIR in the IR schema");
  const members = new Map<string, string>();

  for (const [member, schema] of Object.entries(properties)) {
    const keys = schema.propertyNames as SchemaNode | undefined;

    if (typeof keys?.$ref === "string")
      members.set(keys.$ref.slice(keys.$ref.lastIndexOf("/") + 1), member);
  }

  return members;
}

const CATALOGUE_MEMBERS = readCatalogueMembers();
const CATALOGUES = new Set(CATALOGUE_MEMBERS.values());

/** The entries of a catalogue member of the draft, or `undefined` for a member that is no catalogue. */
function catalogueOf(ir: DraftIR, member: string): Record<string, unknown> | undefined {
  if (!CATALOGUES.has(member) || !Object.hasOwn(ir, member)) return undefined;
  const entries: unknown = Reflect.get(ir, member);

  return isRecord(entries) ? entries : undefined;
}

const entryKey = (entry: FinalizeCatalogueEntry): string =>
  JSON.stringify([entry.member, entry.id]);

// The catalogue entry a pointer of the draft is inside, or `undefined` for a pointer outside every catalogue (an
// operation, the api, the conventions), which is a root.
function ownerOf(pointer: string): FinalizeCatalogueEntry | undefined {
  const [member, id] = pointerSegments(pointer) ?? [];

  if (member === undefined || id === undefined || !CATALOGUES.has(member)) return undefined;

  return { member, id };
}

// The entry a core origin points at: `/errors/api.rate_limited/params` names `errors` entry `api.rate_limited`. An
// origin that carries `api` names an entry of that other api, never of this one.
function coreOriginTarget(origin: Record<string, unknown>): FinalizeCatalogueEntry | undefined {
  if (origin.layer !== CORE_LAYER || Object.hasOwn(origin, "api")) return undefined;

  return typeof origin.pointer === "string" ? ownerOf(origin.pointer) : undefined;
}

// The extension key declarations, by their prefix and key, as an extension slot names them.
function extensionKeyIds(ir: DraftIR): ReadonlyMap<string, string> {
  const ids = new Map<string, string>();

  for (const [id, declaration] of Object.entries(catalogueOf(ir, EXTENSION_KEYS_MEMBER) ?? {})) {
    if (isRecord(declaration)) ids.set(JSON.stringify([declaration.prefix, declaration.key]), id);
  }

  return ids;
}

// The entries an extension slot uses: one per `<prefix>.<key>` written that has a declaration.
function extensionTargets(
  extensions: Record<string, unknown>,
  keyIds: ReadonlyMap<string, string>,
): FinalizeCatalogueEntry[] {
  const targets: FinalizeCatalogueEntry[] = [];

  for (const [prefix, keys] of Object.entries(extensions)) {
    if (!isRecord(keys)) continue;

    for (const key of Object.keys(keys)) {
      const id = keyIds.get(JSON.stringify([prefix, key]));

      if (id !== undefined) targets.push({ member: EXTENSION_KEYS_MEMBER, id });
    }
  }

  return targets;
}

/** Every reference of the draft, keyed by the entry that holds it ("" for a root). */
function referencesByOwner(ir: DraftIR): Map<string, FinalizeCatalogueEntry[]> {
  const references = new Map<string, FinalizeCatalogueEntry[]>();
  const keyIds = extensionKeyIds(ir);
  const add = (pointer: string, targets: readonly FinalizeCatalogueEntry[]): void => {
    const owner = ownerOf(pointer);
    const key = owner === undefined ? "" : entryKey(owner);

    const held = references.get(key) ?? [];

    held.push(...targets);
    references.set(key, held);
  };

  walkIrInstance(ir, (node) => {
    if (node.kind === "string") {
      const member = CATALOGUE_MEMBERS.get(node.definition);

      if (member !== undefined) add(node.pointer, [{ member, id: node.value }]);

      return;
    }

    if (node.kind !== "object") return;

    if (node.definition === "Origin") {
      const target = coreOriginTarget(node.value);

      if (target !== undefined) add(node.pointer, [target]);
    }

    if (isRecord(node.value.extensions))
      add(node.pointer, extensionTargets(node.value.extensions, keyIds));
  });

  return references;
}

/** The entries reachable from the operations, the identities and every other root member, as entry keys. */
function reachableEntries(ir: DraftIR): Set<string> {
  const references = referencesByOwner(ir);
  const reached = new Set<string>();
  const pending: FinalizeCatalogueEntry[] = [...(references.get("") ?? [])];

  for (const member of ROOT_CATALOGUES)
    pending.push(...Object.keys(catalogueOf(ir, member) ?? {}).map((id) => ({ member, id })));

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const key = entryKey(next);

    if (reached.has(key)) continue;
    reached.add(key);
    pending.push(...(references.get(key) ?? []));
  }

  return reached;
}

/**
 * Drops from `ir`, finalize's copy of the draft, every catalogue entry no operation, identity or other root
 * reaches.
 */
export function finalizePrune(ir: DraftIR): void {
  const reached = reachableEntries(ir);

  for (const member of CATALOGUES) {
    const entries = catalogueOf(ir, member);

    if (entries === undefined) continue;

    for (const id of Object.keys(entries)) {
      if (reached.has(entryKey({ member, id }))) continue;
      Reflect.deleteProperty(entries, id);
    }
  }
}
