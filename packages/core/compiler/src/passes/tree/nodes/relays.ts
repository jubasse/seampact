import type { ContractIR, IrWriter, Operation } from "@seampact/spec/ir";
import { listIrUnknowns } from "@seampact/spec/ir";
import {
  type DraftIR,
  type DraftOperation,
  type PassReadonly,
  pipelineCanonical,
  pipelineCopy,
  pipelinePointerBelow,
} from "../../../pipeline/seam.js";
import {
  type TreeNodesRule,
  treeNodesError,
  treeNodesLocate,
  treeNodesNodeOrigin,
} from "./diagnostics.js";
import type { TreeNodesSite } from "./fields.js";
import { type TreeNodesContext, treeNodesText } from "./raw.js";

// Relay routes (ADR 0002 section 7): the shape of the public operation a relay route names, copied from the
// derived draft of a workspace api (`relayed`) or from the IR of an import (`imported`). Only the public
// operation's declared elements and the elements of tree.nodes' own derivations are copied, each stamped
// `derivedFrom: relay.route` with its origin in the other api; the derivations of the other halves (credential
// params, paging params, ETag and deprecation headers) are the relay route's own to derive.

const RELAY_DERIVATION = "relay.route";

const OPERATION_KIND = "httpOperation";

// The derivations of tree.nodes that a relay route copies, since it has no `op` to derive them again.
const COPIED_RESPONSE_DERIVATIONS: readonly string[] = [
  "response.format",
  "batch.read",
  RELAY_DERIVATION,
];

const COPIED_ELEMENT_DERIVATIONS: readonly string[] = [RELAY_DERIVATION];

type RelayedOperation = PassReadonly<DraftOperation>;

type RelayedFormat = PassReadonly<IrWriter.WireFormat>;

type RelayedPagingStyle = PassReadonly<IrWriter.PagingStyle>;

/** The public operation of a relay route, with what its copy reads from its api. */
interface RelaySource {
  readonly api: string;
  readonly operation: RelayedOperation;
  readonly surfacePrefix: string | undefined;
  readonly format: RelayedFormat | undefined;
  readonly pagingStyle: RelayedPagingStyle | undefined;
}

/** A wire format or a paging style a relay route copies, joined to this api's catalogue once both are written. */
export type TreeNodesRelayDeclaration =
  | (RelayDeclarationSite & { readonly catalogue: "formats"; readonly value: IrWriter.WireFormat })
  | (RelayDeclarationSite & {
      readonly catalogue: "pagings";
      readonly value: IrWriter.PagingStyle;
    });

interface RelayDeclarationSite {
  readonly id: string;
  readonly site: TreeNodesSite;
  readonly relays: string;
}

/** The target a relay route names: `relays: <api>.<operationId>`. */
interface RelayTarget {
  readonly api: string;
  readonly id: string;
  readonly text: string;
}

/**
 * The members of a relay route copied from the public operation: method, safety, path, params, input, success
 * responses, paging, concurrency, format and `relays`. Undefined when the target is refused (reported); the
 * copied format and paging style are pushed to `declarations`.
 */
export function treeNodesRelayShape(
  site: TreeNodesSite,
  ownPrefix: string,
  declarations: TreeNodesRelayDeclaration[],
): DraftOperation | undefined {
  const target = relayTarget(site);
  const source = relaySource(site, target);

  if (source === undefined) return undefined;

  checkRouteName(site, target);
  const { operation, api } = source;

  if (operation.origin === undefined)
    throw new Error(`the relayed operation ${target.text} has no origin`);

  const stamp: RelayStamp = { api, from: relayOrigin(operation.origin, api) };

  pushDeclarations(source, site, target, declarations);

  return {
    ...(operation.method === undefined ? {} : { method: operation.method }),
    ...(operation.safe === undefined ? {} : { safe: operation.safe }),
    ...(operation.path === undefined ? {} : { path: relayPath(source, ownPrefix) }),
    params: copiedParams(operation.params, stamp),
    ...(operation.input === undefined ? {} : { input: copiedInput(operation.input, api) }),
    responses: copiedResponses(operation.responses ?? [], stamp),
    ...(operation.paging === undefined ? {} : { paging: copiedPaging(operation.paging, api) }),
    ...(operation.concurrency === undefined
      ? {}
      : {
          concurrency: {
            version: pipelineCopy(operation.concurrency.version),
            field: operation.concurrency.field,
          },
        }),
    ...(operation.format === undefined ? {} : { format: operation.format }),
    relays: { kind: OPERATION_KIND, api, id: target.id },
  };
}

/** Joins each copied format and paging style to this api's catalogue: absent, it is added; present, it is the same. */
export function treeNodesJoinRelayDeclarations(
  draft: DraftIR,
  context: TreeNodesContext,
  declarations: readonly TreeNodesRelayDeclaration[],
): void {
  const joinedBy = new Map<string, TreeNodesRelayDeclaration>();

  for (const declaration of declarations) {
    const key = `${declaration.catalogue}:${declaration.id}`;
    const held = heldDeclaration(draft, declaration);

    if (held === undefined) {
      addDeclaration(draft, declaration);
      joinedBy.set(key, declaration);
      continue;
    }

    if (sameDeclaration(held, declaration.value)) continue;

    reportDifferentDeclaration(context, declaration, held.origin, joinedBy.get(key));
  }
}

function heldDeclaration(
  draft: DraftIR,
  declaration: TreeNodesRelayDeclaration,
): IrWriter.WireFormat | IrWriter.PagingStyle | undefined {
  const catalogue = declaration.catalogue === "formats" ? draft.formats : draft.pagings;

  return Object.hasOwn(catalogue, declaration.id) ? catalogue[declaration.id] : undefined;
}

function addDeclaration(draft: DraftIR, declaration: TreeNodesRelayDeclaration): void {
  if (declaration.catalogue === "formats") draft.formats[declaration.id] = declaration.value;
  else draft.pagings[declaration.id] = declaration.value;
}

// Two declarations are one when they differ by their origin only: a shared file read by both apis.
function sameDeclaration(held: { readonly origin: IrWriter.Origin }, copied: object): boolean {
  const { origin: _heldOrigin, ...heldRest } = held;
  const copiedRest = Object.fromEntries(Object.entries(copied).filter(([key]) => key !== "origin"));

  return pipelineCanonical(heldRest) === pipelineCanonical(copiedRest);
}

function reportDifferentDeclaration(
  context: TreeNodesContext,
  declaration: TreeNodesRelayDeclaration,
  heldOrigin: IrWriter.Origin,
  firstCopy: TreeNodesRelayDeclaration | undefined,
): void {
  const { site, id } = declaration;
  const kind = declaration.catalogue === "formats" ? "wire format" : "paging style";
  const origin = relaysOrigin(site);
  const held =
    firstCopy === undefined
      ? { origin: treeNodesLocate(heldOrigin, origin), message: `the ${kind} ${id} of this api` }
      : {
          origin: relaysOrigin(firstCopy.site),
          message: `the ${kind} ${id} copied for the relay route ${firstCopy.site.operationId}`,
        };

  context.report(
    treeNodesError({
      rule: "relay-declaration",
      origin,
      message: `The relay route ${site.operationId} copies the ${kind} ${id} of ${declaration.relays}, which differs from the ${kind} ${id} this api already holds.`,
      fix: `Declare ${id} once in a shared file both apis read, or rename one of the two.`,
      related: [
        held,
        {
          origin: treeNodesLocate(declaration.value.origin, origin),
          message: `the ${kind} ${id} of ${declaration.relays}`,
        },
      ],
    }),
  );
}

function pushDeclarations(
  source: RelaySource,
  site: TreeNodesSite,
  target: RelayTarget,
  declarations: TreeNodesRelayDeclaration[],
): void {
  const { operation, api } = source;
  const relaySite = { site, relays: target.text };

  if (operation.format !== undefined && source.format !== undefined)
    declarations.push({
      ...relaySite,
      catalogue: "formats",
      id: operation.format,
      value: { ...pipelineCopy(source.format), origin: relayOrigin(source.format.origin, api) },
    });

  const style = operation.paging?.style;

  if (style !== undefined && source.pagingStyle !== undefined)
    declarations.push({
      ...relaySite,
      catalogue: "pagings",
      id: style,
      value: {
        ...pipelineCopy(source.pagingStyle),
        origin: relayOrigin(source.pagingStyle.origin, api),
      },
    });
}

// An element copied from another api carries that api; an element that api copied in turn keeps its own, and a
// core declaration, which no api holds, has none.
function relayOrigin(origin: PassReadonly<IrWriter.Origin>, api: string): IrWriter.Origin {
  if (origin.layer === "core" || origin.api !== undefined) return pipelineCopy(origin);

  return { api, ...pipelineCopy(origin) };
}

/** The api a copied element comes from, and the public operation's origin its `derivedFrom` names. */
interface RelayStamp {
  readonly api: string;
  readonly from: IrWriter.Origin;
}

// A copied element: its origin in the other api, and `derivedFrom: relay.route` from the public operation.
function stamped<Element extends { origin?: IrWriter.Origin; derivedFrom?: IrWriter.DerivedFrom }>(
  element: Element,
  stamp: RelayStamp,
): Element {
  return {
    ...element,
    ...(element.origin === undefined ? {} : { origin: relayOrigin(element.origin, stamp.api) }),
    derivedFrom: { derivation: RELAY_DERIVATION, from: [pipelineCopy(stamp.from)] },
  };
}

const isCopied = (
  element: { readonly derivedFrom?: PassReadonly<IrWriter.DerivedFrom> },
  derivations: readonly string[],
): boolean =>
  element.derivedFrom === undefined || derivations.includes(element.derivedFrom.derivation);

function copiedParams(
  params: PassReadonly<IrWriter.Params> | undefined,
  stamp: RelayStamp,
): IrWriter.Params {
  const copied = (list: readonly PassReadonly<IrWriter.Param>[] | undefined) =>
    (list ?? [])
      .filter((param) => isCopied(param, COPIED_ELEMENT_DERIVATIONS))
      .map((param) => stamped(pipelineCopy(param), stamp));

  return {
    path: copied(params?.path),
    query: copied(params?.query),
    header: copied(params?.header),
  };
}

// The body input with its media, schema and fields; never `proofs`, `rawBody` or `bodyLimitBytes`, which the
// relay route derives under its own settings.
function copiedInput(
  input: PassReadonly<NonNullable<DraftOperation["input"]>>,
  api: string,
): NonNullable<DraftOperation["input"]> {
  return {
    media: input.media,
    schema: pipelineCopy(input.schema),
    ...(input.fields === undefined ? {} : { fields: pipelineCopy(input.fields) }),
    origin: relayOrigin(input.origin, api),
  };
}

function copiedResponses(
  responses: readonly PassReadonly<IrWriter.Response>[],
  stamp: RelayStamp,
): IrWriter.Response[] {
  return responses
    .filter((response) => isCopied(response, COPIED_RESPONSE_DERIVATIONS))
    .map((response) => ({
      ...stamped(pipelineCopy(response), stamp),
      headers: response.headers
        .filter((header) => isCopied(header, COPIED_ELEMENT_DERIVATIONS))
        .map((header) => stamped(pipelineCopy(header), stamp)),
    }));
}

// Sort keys carry their key and origin only: their rights are the gateway's, and the paging's relay provenance
// is the operation's `relays`.
function copiedPaging(paging: PassReadonly<IrWriter.Paging>, api: string): IrWriter.Paging {
  return {
    ...(paging.style === undefined ? {} : { style: paging.style }),
    ...(paging.maxLimit === undefined ? {} : { maxLimit: paging.maxLimit }),
    ...(paging.defaultLimit === undefined ? {} : { defaultLimit: paging.defaultLimit }),
    overLimit: pipelineCopy(paging.overLimit),
    ...(paging.token === undefined ? {} : { token: paging.token }),
    sortKeys: paging.sortKeys.map((sortKey) => ({
      key: sortKey.key,
      ...(sortKey.origin === undefined ? {} : { origin: relayOrigin(sortKey.origin, api) }),
    })),
    origin: relayOrigin(paging.origin, api),
  };
}

// The public path after its surface's prefix, appended to this surface's prefix.
function relayPath(source: RelaySource, ownPrefix: string): string {
  const { operation, surfacePrefix } = source;
  const path = operation.path ?? "";

  if (surfacePrefix === undefined || !path.startsWith(surfacePrefix))
    throw new Error(
      `the relayed operation ${source.api}.${operation.id} has the path ${path}, which does not start with the prefix of its surface ${operation.surface}`,
    );

  return `${ownPrefix}${path.slice(surfacePrefix.length)}`;
}

// The authoring schema admits `relays` as `<api>.<operationId>` only.
function relayTarget({ node }: TreeNodesSite): RelayTarget {
  const text = treeNodesText(node, "relays");
  const dot = text?.indexOf(".") ?? -1;

  if (text === undefined || dot <= 0)
    throw new Error(`the relay route at ${node.pointer} has no relays <api>.<operationId>`);

  return { api: text.slice(0, dot), id: text.slice(dot + 1), text };
}

function relaySource(site: TreeNodesSite, target: RelayTarget): RelaySource | undefined {
  const relayed = site.context.relayed(target.api);

  if (relayed !== undefined) return relayedSource(site, target, relayed);

  const imported = site.context.imported(target.api);

  if (imported !== undefined) return importedSource(site, target, imported);

  reportTarget(
    site,
    `relays ${target.text}, but ${target.api} is neither an api of the workspace nor an import`,
    "Name an api of the workspace, or add it to workspace.imports.",
  );

  return undefined;
}

function relayedSource(
  site: TreeNodesSite,
  target: RelayTarget,
  relayed: PassReadonly<DraftIR>,
): RelaySource | undefined {
  const operation = relayed.operations.find(
    (candidate) => candidate.kind === OPERATION_KIND && candidate.id === target.id,
  );

  if (operation === undefined) {
    reportNoOperation(site, target);

    return undefined;
  }

  const surfaces = relayed.api?.surfaces;
  const surface = operation.surface;

  return {
    api: target.api,
    operation,
    surfacePrefix:
      surfaces !== undefined && surface !== undefined && Object.hasOwn(surfaces, surface)
        ? surfaces[surface]?.prefix
        : undefined,
    format: ownEntry(relayed.formats, operation.format),
    pagingStyle: ownEntry(relayed.pagings, operation.paging?.style),
  };
}

// An imported IR may hold a union arm or an open-enum value this compiler does not know: the operation is copied
// only when none sits in it, its format or its paging style; each one found is named.
function importedSource(
  site: TreeNodesSite,
  target: RelayTarget,
  imported: PassReadonly<ContractIR>,
): RelaySource | undefined {
  const index = imported.operations.findIndex(
    (candidate) => candidate.kind === OPERATION_KIND && candidate.id === target.id,
  );
  const operation = imported.operations[index];

  if (operation === undefined) {
    reportNoOperation(site, target);

    return undefined;
  }

  const style = operation.paging?.style;
  const copiedPointers = [
    `/operations/${index}`,
    ...(operation.format === undefined ? [] : [pipelinePointerBelow("/formats", operation.format)]),
    ...(style === undefined ? [] : [pipelinePointerBelow("/pagings", style)]),
  ];
  const unknowns = unknownsUnder(imported, copiedPointers);

  if (!isKnownOperation(operation, unknowns)) {
    reportTarget(
      site,
      `relays ${target.text}, which holds what this compiler does not know (${unknowns.join(", ")}), so it cannot be copied`,
      `Compile with a seampact version that reads the IR of ${target.api}, or relay another operation.`,
      "relay-unknown",
    );

    return undefined;
  }

  const surfaces = imported.api.surfaces;
  const surface = operation.surface;

  return {
    api: target.api,
    operation,
    surfacePrefix: Object.hasOwn(surfaces, surface) ? surfaces[surface]?.prefix : undefined,
    format: knownEntry(imported.formats, operation.format, unknowns),
    pagingStyle: knownEntry(imported.pagings, style, unknowns),
  };
}

// Each unknown union tag or open-enum value at or below one of the pointers, named by its pointer and value.
function unknownsUnder(imported: PassReadonly<ContractIR>, pointers: readonly string[]): string[] {
  const { kinds, values } = listIrUnknowns(imported);
  const isUnder = (pointer: string) =>
    pointers.some((root) => pointer === root || pointer.startsWith(`${root}/`));

  return [
    ...kinds
      .filter(({ pointer }) => isUnder(pointer))
      .map(({ pointer, tag, value }) => `${tag} ${value} at ${pointer}`),
    ...values
      .filter(({ pointer }) => isUnder(pointer))
      .map(({ pointer, value }) => `${value} at ${pointer}`),
  ];
}

// `listIrUnknowns` found no unknown arm or value in the operation, so it is one the writer types describe.
const isKnownOperation = (
  operation: PassReadonly<Operation>,
  unknowns: readonly string[],
): operation is PassReadonly<IrWriter.Operation> => unknowns.length === 0;

function knownEntry<Reader, Writer extends Reader>(
  catalogue: Readonly<Record<string, Reader>>,
  id: string | undefined,
  unknowns: readonly string[],
): Writer | undefined {
  const entry = ownEntry(catalogue, id);

  return entry !== undefined && isKnown<Reader, Writer>(entry, unknowns) ? entry : undefined;
}

const isKnown = <Reader, Writer extends Reader>(
  _entry: Reader,
  unknowns: readonly string[],
): _entry is Writer => unknowns.length === 0;

const ownEntry = <Value>(
  catalogue: Readonly<Record<string, Value>>,
  id: string | undefined,
): Value | undefined =>
  id !== undefined && Object.hasOwn(catalogue, id) ? catalogue[id] : undefined;

// The route name is the public operation id unless the route sets `operationId` (grammar section 7).
function checkRouteName(site: TreeNodesSite, target: RelayTarget): void {
  const { node } = site;

  if (treeNodesText(node, "operationId") !== undefined || node.name === target.id) return;

  site.context.report(
    treeNodesError({
      rule: "relay-name",
      origin: treeNodesNodeOrigin(node.origin),
      message: `The relay route ${node.name} relays ${target.text}, so its name must be the public operation id ${target.id}.`,
      fix: `Rename the route ${target.id}, or set operationId on it.`,
    }),
  );
}

function reportNoOperation(site: TreeNodesSite, target: RelayTarget): void {
  reportTarget(
    site,
    `relays ${target.text}, but the api ${target.api} has no operation ${target.id}`,
    `Name an operation id of ${target.api}.`,
  );
}

function reportTarget(
  site: TreeNodesSite,
  fault: string,
  fix: string,
  rule: TreeNodesRule = "relay-target",
): void {
  site.context.report(
    treeNodesError({
      rule,
      origin: relaysOrigin(site),
      message: `The relay route ${site.operationId} ${fault}.`,
      fix,
    }),
  );
}

function relaysOrigin({ node, context }: TreeNodesSite) {
  return treeNodesNodeOrigin(context.origin(`${node.pointer}/relays`) ?? node.origin);
}
