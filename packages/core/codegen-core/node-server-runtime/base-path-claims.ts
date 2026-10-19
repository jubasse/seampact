// The base paths the apis of one app claim, so a path under a base path that another api of the app also claims is
// left to the app: no api answers its 404 for another api's routes. Every api's copy of the runtime shares one
// registry, kept on the global object under a registered symbol. Copied into the generated tree as is.
import { type ContractApi, isUnderBasePath } from "./contract-route.js";
import type { ListedRoute } from "./framework-routes.js";

/** An api's id, base paths and routes, as the registry keeps them. */
export interface BasePathClaim {
  readonly id: string;
  readonly basePaths: readonly string[];
  readonly routes: readonly ListedRoute[];
}

// One key for every copy of this module, so two apis generated apart still see each other.
const REGISTRY_KEY = Symbol.for("seampact.node-server.base-path-claims");

type ClaimRegistry = WeakMap<object, Map<string, BasePathClaim>>;

function claimRegistry(): ClaimRegistry {
  const existing: unknown = Reflect.get(globalThis, REGISTRY_KEY);

  if (existing instanceof WeakMap) return existing;

  const created: ClaimRegistry = new WeakMap();

  Reflect.set(globalThis, REGISTRY_KEY, created);

  return created;
}

/** Records that an api is served by an app, keyed by an object the app owns (its server, adapter or router). */
export function registerBasePathClaim(owner: object, api: ContractApi): void {
  const registry = claimRegistry();
  const claims = registry.get(owner) ?? new Map<string, BasePathClaim>();

  claims.set(api.id, {
    id: api.id,
    basePaths: [...api.basePaths],
    routes: api.routes.map((route) => ({ method: route.method.toUpperCase(), path: route.path })),
  });
  registry.set(owner, claims);
}

/** The claims recorded under an owner, none when it has none. */
export function basePathClaimsOf(owner: object): readonly BasePathClaim[] {
  return [...(claimRegistry().get(owner)?.values() ?? [])];
}

/**
 * Whether the api alone claims a path among the claims of its app: the path is under one of its base paths and
 * under none of another api's. A path two apis claim is the app's to answer.
 */
export function claimsBasePathAlone(
  api: ContractApi,
  claims: readonly BasePathClaim[],
  path: string,
): boolean {
  if (!isUnderBasePath(api, path)) return false;

  return claims.every((claim) => claim.id === api.id || !isUnderBasePath(claim, path));
}
