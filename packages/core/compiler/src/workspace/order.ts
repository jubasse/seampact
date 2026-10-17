import type { Origin } from "@seampact/spec/ir";
import type { Diagnostic, DiagnosticOrigin, RelatedLocation } from "../diagnostics/diagnostic.js";
import {
  type PassReadonly,
  type PipelineRelayStage,
  pipelineOrigin,
  pipelinePointerBelow,
  pipelineTreeNodes,
} from "../pipeline/seam.js";
import type { RawApi } from "../raw-tree.js";
import type { ApiDiagnostics } from "../validate/validate.js";

// The relay order of a workspace (ADR 0006 section 1): each api compiles after every workspace api its relay
// routes name, in workspace order where no relay decides, and relays that form a cycle are refused. A relay to an
// import or to a name that is no api is not ordered: tree.nodes checks the name.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).

export const WORKSPACE_RELAY_CYCLE_RULE = "seampact/workspace/relay-cycle";

/** A relay route of an api that names a workspace api, located at its `relays` member. */
interface WorkspaceRelayRoute {
  readonly target: string;
  readonly origin: DiagnosticOrigin;
}

const isDiagnosticOrigin = (origin: Origin): origin is DiagnosticOrigin => origin.layer !== "core";

// `relays: <api>.<operationId>`: the api is the text before the first dot.
function relayTargetApi(relays: unknown): string | undefined {
  if (typeof relays !== "string") return undefined;
  const dot = relays.indexOf(".");

  return dot <= 0 ? undefined : relays.slice(0, dot);
}

function workspaceRelayRoutes(
  raw: PassReadonly<RawApi>,
  workspaceApis: ReadonlySet<string>,
): WorkspaceRelayRoute[] {
  const routes: WorkspaceRelayRoute[] = [];

  for (const node of pipelineTreeNodes(raw)) {
    if (node.kind !== "relay") continue;
    const target = relayTargetApi(node.settings.relays);

    if (target === undefined || !workspaceApis.has(target)) continue;
    const pointer = pipelinePointerBelow(node.pointer, "relays");
    const origin = pipelineOrigin(raw, pointer);

    if (origin === undefined || !isDiagnosticOrigin(origin))
      throw new Error(`relay order: api '${raw.name}' has no source location for ${pointer}`);

    routes.push({ target, origin });
  }

  return routes;
}

// The strongly connected components of the relay graph (Tarjan), each listed in workspace order.
function relayComponents(
  apis: readonly string[],
  relaysTo: ReadonlyMap<string, readonly string[]>,
): Map<string, readonly string[]> {
  const componentOf = new Map<string, readonly string[]>();
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indexOf = (api: string) => index.get(api) ?? 0;
  const lowLinkOf = (api: string) => lowLink.get(api) ?? 0;

  const connect = (api: string): void => {
    index.set(api, index.size);
    lowLink.set(api, indexOf(api));
    stack.push(api);
    onStack.add(api);

    for (const target of relaysTo.get(api) ?? []) {
      if (!index.has(target)) {
        connect(target);
        lowLink.set(api, Math.min(lowLinkOf(api), lowLinkOf(target)));
      } else if (onStack.has(target)) {
        lowLink.set(api, Math.min(lowLinkOf(api), indexOf(target)));
      }
    }

    if (lowLinkOf(api) !== indexOf(api)) return;
    const members: string[] = [];

    for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
      onStack.delete(member);
      members.push(member);

      if (member === api) break;
    }

    members.sort((a, b) => apis.indexOf(a) - apis.indexOf(b));

    for (const member of members) componentOf.set(member, members);
  };

  for (const api of apis) if (!index.has(api)) connect(api);

  return componentOf;
}

// Workspace order, each api after the apis it relays to. An api of a cycle waits only for the apis outside its
// cycle, so every api is placed once and an api that relays into a cycle comes after the whole cycle.
function relayPlacement(
  apis: readonly string[],
  relaysTo: ReadonlyMap<string, readonly string[]>,
  componentOf: ReadonlyMap<string, readonly string[]>,
): string[] {
  const placed = new Set<string>();
  const order: string[] = [];
  const componentPlaced = (api: string) =>
    (componentOf.get(api) ?? [api]).every((member) => placed.has(member));
  const ready = (api: string) =>
    (relaysTo.get(api) ?? []).every(
      (target) => (componentOf.get(api) ?? []).includes(target) || componentPlaced(target),
    );

  while (order.length < apis.length) {
    const next = apis.find((api) => !placed.has(api) && ready(api));

    if (next === undefined) throw new Error("relay order: no workspace api is ready to place");
    placed.add(next);
    order.push(next);
  }

  return order;
}

// One error per api of a cycle, at its first relay route into the cycle, with the other apis' routes related.
function relayCycleDiagnostics(
  members: readonly string[],
  routesOf: ReadonlyMap<string, readonly WorkspaceRelayRoute[]>,
): ApiDiagnostics[] {
  const names = members.map((api) => `'${api}'`).join(", ");
  const routeIntoCycle = (api: string): WorkspaceRelayRoute => {
    const route = (routesOf.get(api) ?? []).find((candidate) => members.includes(candidate.target));

    if (route === undefined)
      throw new Error(`relay order: api '${api}' has no relay into its cycle`);

    return route;
  };

  return members.map((api) => {
    const route = routeIntoCycle(api);
    const related: RelatedLocation[] = members
      .filter((other) => other !== api)
      .map((other) => {
        const otherRoute = routeIntoCycle(other);

        return {
          origin: { ...otherRoute.origin, api: other },
          message: `api '${other}' relays to '${otherRoute.target}' here`,
        };
      });
    const diagnostic: Diagnostic = {
      severity: "error",
      rule: WORKSPACE_RELAY_CYCLE_RULE,
      message: `Relay routes form a cycle between the apis ${names}, so none of them can compile after the others.`,
      fix: `Remove or retarget one relay route of the cycle, this one from '${api}' to '${route.target}' or a related one.`,
      origin: route.origin,
      related,
    };

    return { api, diagnostics: [diagnostic] };
  });
}

export const workspaceRelayOrder: PipelineRelayStage = (workspace) => {
  const apis = workspace.apis.map((api) => api.name);
  const workspaceApis = new Set(apis);
  const routesOf = new Map<string, readonly WorkspaceRelayRoute[]>();
  const relaysTo = new Map<string, readonly string[]>();

  for (const raw of workspace.apis) {
    const routes = workspaceRelayRoutes(raw, workspaceApis);

    routesOf.set(raw.name, routes);
    relaysTo.set(raw.name, [...new Set(routes.map((route) => route.target))]);
  }

  const componentOf = relayComponents(apis, relaysTo);
  const cycles = [...new Set(componentOf.values())].filter(
    (members) =>
      members.length > 1 || members.some((api) => (relaysTo.get(api) ?? []).includes(api)),
  );

  return {
    order: relayPlacement(apis, relaysTo, componentOf),
    relaysTo,
    diagnostics: cycles.flatMap((members) => relayCycleDiagnostics(members, routesOf)),
  };
};
