import type { Api, ContractIR, PackRef, Surface } from "@seampact/spec/ir";
import {
  type ChangeSite,
  compareKeptOrder,
  compareMembers,
  emitAt,
  type WalkContext,
} from "./context.js";
import { pointerJoin } from "./json.js";
import { compareMaturityLevel } from "./maturity.js";
import { commonReaches, INT64_REACH_KEY, OUTPUT_ENUMS_REACH_KEY } from "./reach.js";
import { type ChangeReach, NO_POSITION } from "./sink.js";

// The api member and the packs: route settings shared by operations, the api maturity and policy, the wire forms
// (a change at every use it alters) and the pack list. The api name and version are refused before the walk.

const API_POINTER = "/api";

export function compareApi(context: WalkContext): void {
  const before = context.before.api;
  const after = context.after.api;
  const site: ChangeSite = { reaches: NO_POSITION, origin: after.origin };
  const commonOperations = commonOperationIds(context);
  const defaultPathVersionOperations = operationsFollowingPathVersion(context);

  compareMembers(context, site, "Api", API_POINTER, before, after, {
    id: () => undefined,
    version: () => undefined,
    pathVersion: (pointer) =>
      compareMembers(context, site, "PathVersion", pointer, before.pathVersion, after.pathVersion, {
        value: (valuePointer) =>
          emitAt(
            context,
            { ...site, reaches: [{ position: "none", operations: defaultPathVersionOperations }] },
            {
              kind: "operation.route",
              case: "pathVersion",
              pointer: valuePointer,
              before: before.pathVersion.value,
              after: after.pathVersion.value,
            },
          ),
      }),
    maturity: (pointer) =>
      compareMaturityLevel(context, site, pointer, before.maturity, after.maturity),
    compat: (pointer) =>
      compareMembers(context, site, "Compat", pointer, before.compat, after.compat, {
        policy: (policyPointer) =>
          emitAt(context, site, {
            kind: "compat.policy",
            case: "changed",
            pointer: policyPointer,
            before: before.compat.policy,
            after: after.compat.policy,
          }),
      }),
    wire: (pointer) => compareWire(context, site, pointer, before, after, commonOperations),
    surfaces: (pointer) => compareSurfaces(context, site, pointer, before, after),
  });
}

function commonOperationIds(context: WalkContext): string[] {
  const beforeIds = new Set(context.before.operations.map((operation) => operation.id));

  return context.after.operations
    .map((operation) => operation.id)
    .filter((id) => beforeIds.has(id));
}

/** The common operations whose surface takes the api's pathVersion in both IRs, not a value of its own. */
function operationsFollowingPathVersion(context: WalkContext): string[] {
  const beforeIds = new Set(
    context.before.operations
      .filter((operation) => surfaceFollowsPathVersion(context.before, operation.surface))
      .map((operation) => operation.id),
  );

  return context.after.operations
    .filter((operation) => surfaceFollowsPathVersion(context.after, operation.surface))
    .map((operation) => operation.id)
    .filter((id) => beforeIds.has(id));
}

function surfaceFollowsPathVersion(ir: ContractIR, surfaceId: string): boolean {
  return ir.api.surfaces[surfaceId]?.pathVersion === ir.api.pathVersion.value;
}

function compareWire(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: Api,
  after: Api,
  commonOperations: readonly string[],
): void {
  const outputOfEveryOperation: readonly ChangeReach[] = [
    { position: "output", operations: commonOperations },
  ];
  const atUses = (reachKey: string, outputOnly: boolean) => {
    const reaches = commonReaches(context.beforeReach, context.afterReach, reachKey);

    return outputOnly ? reaches.filter((reach) => reach.position === "output") : reaches;
  };

  compareMembers(context, site, "ApiWire", pointer, before.wire, after.wire, {
    int64: (memberPointer) =>
      emitWireChange(
        context,
        site,
        memberPointer,
        "int64Wire",
        atUses(INT64_REACH_KEY, false),
        before.wire.int64,
        after.wire.int64,
      ),
    outputEnums: (memberPointer) =>
      emitWireChange(
        context,
        site,
        memberPointer,
        "outputEnums",
        atUses(OUTPUT_ENUMS_REACH_KEY, true),
        before.wire.outputEnums,
        after.wire.outputEnums,
      ),
    // Every response may carry a URL the target writes ($self, the paging roles, the successor link).
    urls: (memberPointer) =>
      emitWireChange(
        context,
        site,
        memberPointer,
        "urls",
        outputOfEveryOperation,
        before.wire.urls,
        after.wire.urls,
      ),
  });
}

// A wire form no use reaches alters nothing on the wire: reported as an annotation.
function emitWireChange(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  wireCase: string,
  reaches: readonly ChangeReach[],
  before: string,
  after: string,
): void {
  const used = reaches !== NO_POSITION && reaches.some((reach) => reach.operations.length > 0);

  emitAt(
    context,
    { ...site, reaches: used ? reaches : NO_POSITION },
    {
      kind: used ? "type.changed" : "annotation",
      case: used ? wireCase : `wire.${wireCase}`,
      pointer,
      before,
      after,
    },
  );
}

function compareSurfaces(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: Api,
  after: Api,
): void {
  const surfaceIds = new Set([...Object.keys(before.surfaces), ...Object.keys(after.surfaces)]);

  for (const id of [...surfaceIds].sort()) {
    const beforeSurface = before.surfaces[id];
    const afterSurface = after.surfaces[id];
    const surfacePointer = pointerJoin(pointer, id);

    // A surface holds no wire of its own: its operations are added or removed with it.
    if (beforeSurface === undefined || afterSurface === undefined) {
      emitAt(context, site, { kind: "annotation", case: "surfaces", pointer: surfacePointer });
      continue;
    }

    compareSurface(context, site, surfacePointer, id, beforeSurface, afterSurface);
  }
}

function compareSurface(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  id: string,
  before: Surface,
  after: Surface,
): void {
  const beforeIds = new Set(
    context.before.operations
      .filter((operation) => operation.surface === id)
      .map((operation) => operation.id),
  );
  const operations = context.after.operations
    .filter((operation) => operation.surface === id && beforeIds.has(operation.id))
    .map((operation) => operation.id);
  const surfaceSite: ChangeSite = {
    reaches: [{ position: "none", operations }],
    origin: after.origin,
  };
  const route =
    (routeCase: string) => (memberPointer: string, beforeValue: unknown, afterValue: unknown) =>
      emitAt(context, surfaceSite, {
        kind: "operation.route",
        case: routeCase,
        pointer: memberPointer,
        before: beforeValue,
        after: afterValue,
      });

  compareMembers(context, { ...site, origin: after.origin }, "Surface", pointer, before, after, {
    prefix: route("surfacePrefix"),
    pathVersion: route("pathVersion"),
  });
}

export function comparePacks(
  context: WalkContext,
  before: readonly PackRef[],
  after: readonly PackRef[],
): void {
  const site: ChangeSite = { reaches: NO_POSITION };

  after.forEach((pack, index) => {
    const beforePack = before.find((candidate) => candidate.name === pack.name);
    const pointer = pointerJoin("", "packs", index);

    if (beforePack === undefined) {
      emitAt(context, site, { kind: "pack.upgraded", case: "added", pointer, after: pack.name });

      return;
    }

    if (beforePack.version !== pack.version) {
      emitAt(context, site, {
        kind: "pack.upgraded",
        case: "version",
        pointer,
        before: beforePack.version,
        after: pack.version,
      });
    }
  });

  before.forEach((pack, index) => {
    if (after.some((candidate) => candidate.name === pack.name)) return;

    emitAt(context, site, {
      kind: "pack.upgraded",
      case: "removed",
      pointer: pointerJoin("", "packs", index),
      before: pack.name,
    });
  });

  const nameOf = (pack: PackRef) => pack.name;

  compareKeptOrder(context, site, "/packs", "packs", before.map(nameOf), after.map(nameOf));
}

/** The names of the packs added, removed or at another version: the causes the changes carry. */
export function changedPackNames(
  before: readonly PackRef[],
  after: readonly PackRef[],
): Set<string> {
  const versions = (packs: readonly PackRef[]) =>
    new Map(packs.map((pack) => [pack.name, pack.version]));
  const beforeVersions = versions(before);
  const afterVersions = versions(after);
  const names = new Set([...beforeVersions.keys(), ...afterVersions.keys()]);

  return new Set([...names].filter((name) => beforeVersions.get(name) !== afterVersions.get(name)));
}
