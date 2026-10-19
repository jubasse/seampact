// The boot check of the app's routes outside the contract (ADR 0012 "The boot check"): a route the framework lists
// outside the boundary refuses the start, unless the app config allow-lists it with a reason. The boundary's own
// routes are known by mark. Copied into the generated tree as is.
import type { BootProblem } from "./boundary-hooks.js";
import {
  type FrameworkRouteCheck,
  type ListedRoute,
  routeKey,
  unlistedFrameworkRoutes,
} from "./framework-route-patterns.js";

// One registry for every api's copy of this module, so an api's check skips what another api's boundary added.
const BOUNDARY_ROUTE_KEY = Symbol.for("seampact.node-server.boundary-routes");

function boundaryRouteRegistry(): WeakSet<object> {
  const existing: unknown = Reflect.get(globalThis, BOUNDARY_ROUTE_KEY);

  if (existing instanceof WeakSet) return existing;

  const created = new WeakSet<object>();

  Reflect.set(globalThis, BOUNDARY_ROUTE_KEY, created);

  return created;
}

/** Marks a handler or route record a boundary registers itself (its routes and catch-alls), never a framework route. */
export function markBoundaryRoute(owned: object): void {
  boundaryRouteRegistry().add(owned);
}

export function isBoundaryRoute(value: unknown): boolean {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    boundaryRouteRegistry().has(value)
  );
}

/**
 * One problem per listed route the allow-list does not name; none when the check is off. The caller lists the app's
 * routes without the boundary's own, which it knows by claim, mark or identity, never by path: a route at a contract
 * path outside the boundary serves that path without the boundary's checks.
 */
export function frameworkRouteProblems(
  check: FrameworkRouteCheck,
  listed: readonly ListedRoute[],
): BootProblem[] {
  return unlistedFrameworkRoutes(check, listed).map((route) => ({
    problem: `the framework route '${routeKey(route.method, route.path)}' is outside the contract and not allow-listed`,
    fix: "allow-list it with a reason in the target entry's 'frameworkRoutes' of seampact.config.yaml, or remove the route",
  }));
}
