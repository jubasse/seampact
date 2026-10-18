import {
  type ContractIR,
  checkIrClosedDeclaration,
  type IrClosedDeclarations,
  type IrClosedUnknown,
  type IrWriter,
} from "@seampact/spec/ir";
import {
  type DraftIR,
  type DraftOperation,
  type PassContext,
  type PassReadonly,
  pipelineCanonical,
  pipelineCopy,
  type TreeNode,
} from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";
import type { TreeSchemasCompiler } from "./compile.js";
import { type TreeSchemasReporter, treeSchemasPointer } from "./raw.js";

// Relay-copied declarations (ADR 0002 section 7): the schemas, enums and named formats a relay route's copied
// shape uses join this api, each keeping its origin in the public api with `api` naming it (ADR 0004 section 6).
// The public api is a workspace api that ran (`relayed`) or an import (`imported`, an IR another compiler version
// may have written): each copy holds only what this IR revision knows, else it is refused by name, not copied.
// A name this api already declares, or another relay route copied first, must hold the same declaration; a
// different one is refused, naming both. A copied schema keeps its extension values, so the extension keys they
// use are copied too. The copied uses also give this api's declarations their directions: a parameter or the body
// input is read, a success response written. Nothing about access is copied, so a rule's proof schema is not.

/** A use of a relay route's copied shape, in the direction its position is read or written. */
export interface TreeSchemasRelayUse {
  use: IrWriter.TypeUse;
  direction: IrWriter.Direction;
}

/** What the relay routes of the api copy: the declarations this api lacks, and every copied use. */
export interface TreeSchemasRelayCopies {
  schemas: IrWriter.Schema[];
  enums: IrWriter.Enum[];
  scalars: IrWriter.Scalar[];
  extensionKeys: IrWriter.ExtensionKeyDecl[];
  uses: TreeSchemasRelayUse[];
}

type DeclarationKind = "schema" | "enum" | "named format" | "extension key";

type Declaration = IrWriter.Schema | IrWriter.Enum | IrWriter.Scalar | IrWriter.ExtensionKeyDecl;

// Each catalogue a copy is read from, with the IR definition it is checked against and its kind in messages.
const CATALOGUES = {
  schemas: { definition: "Schema", kind: "schema" },
  enums: { definition: "Enum", kind: "enum" },
  scalars: { definition: "Scalar", kind: "named format" },
  extensionKeys: { definition: "ExtensionKeyDecl", kind: "extension key" },
} as const satisfies Record<
  string,
  { definition: keyof IrClosedDeclarations; kind: DeclarationKind }
>;

type CatalogueName = keyof typeof CATALOGUES;

type CatalogueDefinition<N extends CatalogueName> = (typeof CATALOGUES)[N]["definition"];

// The operation members a relay route's copied shape is read from.
type RelayedOperation = Pick<DraftOperation, "params" | "input" | "responses">;

/** This api's declarations a copy is compared with, by id. */
export interface TreeSchemasLocalDeclarations {
  enums: readonly IrWriter.Enum[];
  extensionKeys: readonly IrWriter.ExtensionKeyDecl[];
}

interface CopySite {
  readonly source: PassReadonly<DraftIR> | PassReadonly<ContractIR>;
  readonly api: string;
  /** The pointer of the route's `relays` member, where a conflict is reported. */
  readonly pointer: string;
  readonly relays: string;
}

// The first status of an error response: the copied shape holds the success responses only.
const ERROR_STATUS = 400;

// `relays: <api>.<operationId>`: the api is the text before the first dot.
function relayTarget(relays: unknown): { api: string; operationId: string } | undefined {
  if (typeof relays !== "string") return undefined;
  const dot = relays.indexOf(".");

  return dot <= 0 ? undefined : { api: relays.slice(0, dot), operationId: relays.slice(dot + 1) };
}

// A member the public api's tree.nodes has not written holds no use to copy.
function operationUses(operation: RelayedOperation): TreeSchemasRelayUse[] {
  const read = (use: IrWriter.TypeUse): TreeSchemasRelayUse => ({ use, direction: "input" });
  const written = (use: IrWriter.TypeUse): TreeSchemasRelayUse => ({ use, direction: "output" });
  const params = operation.params === undefined ? [] : Object.values(operation.params).flat();
  const input = operation.input;
  const successes = (operation.responses ?? []).filter(
    (response) => response.status < ERROR_STATUS,
  );

  return [
    ...params.map((param) => read(param.type)),
    ...(input === undefined ? [] : [read(input.schema)]),
    ...successes.flatMap((response) => [
      ...(response.body === undefined ? [] : [written(response.body)]),
      ...response.headers.map((header) => written(header.type)),
    ]),
  ];
}

// Every origin of a copied declaration keeps its pointer and layer and names the public api.
function withApiOrigins(value: unknown, api: string): void {
  if (Array.isArray(value)) {
    for (const item of value) withApiOrigins(item, api);

    return;
  }

  if (typeof value !== "object" || value === null) return;

  for (const [key, member] of Object.entries(value)) {
    if (key === "origin" && typeof member === "object" && member !== null && !("api" in member))
      Object.assign(member, { api });
    withApiOrigins(member, api);
  }
}

const IGNORED_MEMBERS = new Set(["directions", "origin"]);

// The members holding values the contract wrote: compared whole, since an `origin` key there is data.
const WRITTEN_VALUE_MEMBERS = new Set(["default", "examples", "extensions"]);

function withoutIgnored(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIgnored);

  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !IGNORED_MEMBERS.has(key))
      .map(([key, member]) => [
        key,
        WRITTEN_VALUE_MEMBERS.has(key) ? member : withoutIgnored(member),
      ]),
  );
}

// What two declarations of one name must agree on: everything but the directions, which each api takes from its
// own uses, and the origins, which name the file each api read it from.
const contentOf = (declaration: Declaration): string =>
  pipelineCanonical(withoutIgnored(declaration));

// The extension key ids a copied schema's values use: its own and its properties'.
function extensionKeyIds(schema: IrWriter.Schema): string[] {
  const slots = [
    schema.extensions,
    ...(schema.kind === "object" ? schema.properties.map((property) => property.extensions) : []),
  ];

  return slots.flatMap((slot) =>
    Object.entries(slot).flatMap(([prefix, keys]) =>
      Object.keys(keys).map((key) => `${prefix}-${key}`),
    ),
  );
}

interface FirstCopy {
  readonly declaration: Declaration;
  readonly site: CopySite;
}

class RelayCopier {
  readonly copies: TreeSchemasRelayCopies = {
    schemas: [],
    enums: [],
    scalars: [],
    extensionKeys: [],
    uses: [],
  };
  private readonly seen = new Set<string>();
  private readonly firstCopies = new Map<string, FirstCopy>();
  private readonly enums: ReadonlyMap<string, IrWriter.Enum>;
  private readonly extensionKeys: ReadonlyMap<string, IrWriter.ExtensionKeyDecl>;

  constructor(
    private readonly compiler: TreeSchemasCompiler,
    local: TreeSchemasLocalDeclarations,
    private readonly reporter: TreeSchemasReporter,
  ) {
    this.enums = new Map(local.enums.map((declared) => [declared.id, declared]));
    this.extensionKeys = new Map(local.extensionKeys.map((declared) => [declared.id, declared]));
  }

  copyRoute(site: CopySite, operation: RelayedOperation): void {
    for (const relayUse of operationUses(operation)) {
      this.copies.uses.push(relayUse);
      this.reach(site, relayUse.use);
    }
  }

  private reach(site: CopySite, use: IrWriter.TypeUse): void {
    switch (use.kind) {
      case "ref":
        this.schema(site, use.schema);

        return;
      case "enum":
        this.enumOf(site, use.enum);

        return;
      case "array":
        this.reach(site, use.items);

        return;
      case "scalar":
        if (use.scalar !== undefined) this.scalar(site, use.scalar);

        if (use.content !== undefined) this.reach(site, use.content.schema);

        return;
      case "file":
      case "opaque":
        return;
    }
  }

  private schema(site: CopySite, id: string): void {
    const relayed = this.copyOf(site, "schemas", id);

    if (relayed === undefined) return;
    this.join(site, "schema", relayed, this.compiler.schemas.get(id), this.copies.schemas);

    for (const keyId of extensionKeyIds(relayed)) this.extensionKey(site, keyId);

    if (relayed.kind === "object") {
      for (const property of relayed.properties) this.reach(site, property.type);

      return;
    }

    if (relayed.kind === "map") {
      if (relayed.keys !== undefined) this.reach(site, relayed.keys);
      this.reach(site, relayed.values);

      return;
    }

    for (const variant of relayed.variants) this.schema(site, variant.schema);
  }

  private enumOf(site: CopySite, id: string): void {
    const relayed = this.copyOf(site, "enums", id);

    if (relayed === undefined) return;
    this.join(site, "enum", relayed, this.enums.get(id), this.copies.enums);

    if (relayed.source?.kind === "enum") this.enumOf(site, relayed.source.enum);
  }

  private extensionKey(site: CopySite, id: string): void {
    const relayed = this.copyOf(site, "extensionKeys", id);

    if (relayed === undefined) return;
    this.join(
      site,
      "extension key",
      relayed,
      this.extensionKeys.get(id),
      this.copies.extensionKeys,
    );
    this.reach(site, relayed.schema);
  }

  private scalar(site: CopySite, id: string): void {
    const relayed = this.copyOf(site, "scalars", id);

    if (relayed === undefined) return;
    const local = this.compiler.scalars.all().find((declared) => declared.id === id);

    this.join(site, "named format", relayed, local, this.copies.scalars);
  }

  // A declaration this api lacks is copied once; a later copy of that id from another api is compared with it.
  private join<Value extends Declaration>(
    site: CopySite,
    kind: DeclarationKind,
    relayed: Value,
    local: Value | undefined,
    copies: Value[],
  ): void {
    if (local !== undefined) {
      this.compareLocal(site, kind, relayed, local);

      return;
    }

    const firstKey = `${kind}#${relayed.id}`;
    const first = this.firstCopies.get(firstKey);

    if (first !== undefined) {
      this.compareFirst(site, kind, relayed, first);

      return;
    }

    const copied = this.copied(relayed, site);

    copies.push(copied);
    this.firstCopies.set(firstKey, { declaration: copied, site });
  }

  // A copy of a declaration of the public api, once per name and api; undefined once seen, or when it holds what
  // this IR revision does not know (refused).
  private copyOf<N extends CatalogueName>(
    site: CopySite,
    catalogue: N,
    id: string,
  ): IrClosedDeclarations[CatalogueDefinition<N>] | undefined {
    const seenKey = `${site.api}#${catalogue}:${id}`;
    const declarations: PassReadonly<Record<string, unknown>> = site.source[catalogue];
    const declared: unknown = Object.hasOwn(declarations, id) ? declarations[id] : undefined;

    if (this.seen.has(seenKey) || declared === undefined) return undefined;
    this.seen.add(seenKey);
    const definition: CatalogueDefinition<N> = CATALOGUES[catalogue].definition;
    const copied: unknown = pipelineCopy(declared);
    const { closed, unknowns } = checkIrClosedDeclaration(
      definition,
      copied,
      treeSchemasPointer("", catalogue, id),
    );

    if (unknowns === undefined) return closed;
    this.reportUnknowns(site, `the ${CATALOGUES[catalogue].kind} '${id}'`, unknowns);

    return undefined;
  }

  private reportUnknowns(
    site: CopySite,
    copied: string,
    unknowns: readonly IrClosedUnknown[],
  ): void {
    const named = unknowns.map((unknown) => `${quote(unknown.value)} at ${unknown.pointer}`);

    this.reporter.error({
      rule: "relay-unknown",
      pointer: site.pointer,
      message: `${copied} that ${site.relays} uses holds what this compiler does not know (${named.join(", ")}), so it is not copied`,
      fix: `compile with a seampact version that reads the IR of ${site.api}, or relay another operation`,
    });
  }

  private copied<Value extends Declaration>(relayed: Value, site: CopySite): Value {
    withApiOrigins(relayed, site.api);

    // This api writes the directions from its own uses; an extension key has none.
    return "directions" in relayed ? { ...relayed, directions: [] } : relayed;
  }

  private compareLocal(
    site: CopySite,
    kind: DeclarationKind,
    relayed: Declaration,
    local: Declaration,
  ): void {
    if (contentOf(relayed) === contentOf(local)) return;
    this.reporter.error({
      rule: "relay-declaration",
      pointer: site.pointer,
      message: `the ${kind} '${relayed.id}' that ${site.relays} uses differs from the one this api declares`,
      fix: "declare it once in a shared file both apis load, or rename one of them",
      related: [{ pointer: local.origin.pointer, message: `this api's ${kind} '${local.id}'` }],
    });
  }

  private compareFirst(
    site: CopySite,
    kind: DeclarationKind,
    relayed: Declaration,
    first: FirstCopy,
  ): void {
    if (contentOf(relayed) === contentOf(first.declaration)) return;
    this.reporter.error({
      rule: "relay-declaration",
      pointer: site.pointer,
      message: `the ${kind} '${relayed.id}' that ${site.relays} uses differs from the one ${first.site.relays} uses`,
      fix: "declare it once in a shared file both public apis load, or rename one of them",
      related: [
        { pointer: first.site.pointer, message: `the route relaying ${first.site.relays}` },
      ],
    });
  }
}

// The public operation a relay route names, from a workspace api that ran or an import; undefined when neither
// holds it, or when the imported one holds what this IR revision does not know: tree.nodes reports both.
function publicOperation(
  context: PassContext,
  target: { api: string; operationId: string },
): { source: CopySite["source"]; operation: RelayedOperation } | undefined {
  const relayed = context.relayed(target.api);

  if (relayed !== undefined) {
    const operation = relayed.operations.find((each) => each.id === target.operationId);

    return operation === undefined
      ? undefined
      : { source: relayed, operation: pipelineCopy(operation) };
  }

  const imported = context.imported(target.api);
  const index = imported?.operations.findIndex((each) => each.id === target.operationId) ?? -1;

  if (imported === undefined || index < 0) return undefined;
  const check = checkIrClosedDeclaration(
    "Operation",
    pipelineCopy(imported.operations[index]),
    treeSchemasPointer("", "operations", String(index)),
  );

  return check.closed === undefined ? undefined : { source: imported, operation: check.closed };
}

/**
 * Copies the declarations each relay route's public operation uses (ADR 0002 section 7) from the derived draft of
 * the workspace api it names, or from the IR of the import it names. A route naming an api or operation that has
 * not run, or an imported operation this compiler cannot read, is tree.nodes' to report.
 */
export function treeSchemasCopyRelayDeclarations(
  compiler: TreeSchemasCompiler,
  local: TreeSchemasLocalDeclarations,
  nodes: readonly TreeNode[],
  context: PassContext,
  reporter: TreeSchemasReporter,
): TreeSchemasRelayCopies {
  const copier = new RelayCopier(compiler, local, reporter);

  for (const node of nodes) {
    if (node.kind !== "relay") continue;
    const target = relayTarget(node.settings.relays);
    const found = target === undefined ? undefined : publicOperation(context, target);

    if (target === undefined || found === undefined) continue;
    copier.copyRoute(
      {
        source: found.source,
        api: target.api,
        pointer: treeSchemasPointer(node.pointer, "relays"),
        relays: `${target.api}.${target.operationId}`,
      },
      found.operation,
    );
  }

  return copier.copies;
}
