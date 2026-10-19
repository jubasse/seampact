// The boot check of the app's routes outside the contract (ADR 0012 "The boot check"): a route the framework lists
// that no api of the app serves refuses the start, unless the app config allow-lists it with a reason, by its path
// or a path pattern (ADR 0011 "The app config"). Copied into the generated tree as is.
import type { BasePathClaim } from "./base-path-claims.js";
import type { BootProblem } from "./boundary-hooks.js";

/** One `frameworkRoutes` entry of the app config: a path or a pattern (`*` one segment, `**` any number). */
export interface FrameworkRouteAllowance {
  readonly method?: string;
  readonly path: string;
  readonly reason: string;
}

/** The check as the app config asks it: on with its allow-list, or off (`artefacts.bootCheck.frameworkRoutes`). */
export type FrameworkRouteCheck =
  | { readonly status: "on"; readonly allowed: readonly FrameworkRouteAllowance[] }
  | { readonly status: "off" };

/** A route as a framework lists it: its upper-case method, `ALL` for every method, and its path pattern. */
export interface ListedRoute {
  readonly method: string;
  readonly path: string;
}

const ANY_METHOD = "ALL";
const HEAD_METHOD = "HEAD";
const GET_METHOD = "GET";
const ONE_SEGMENT = "*";
const ANY_SEGMENTS = "**";
const PARAM_SEGMENT = "{}";

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

/** The routes the apis of an app serve, from their claims. */
export function contractRoutesOf(claims: readonly BasePathClaim[]): ListedRoute[] {
  return claims.flatMap((claim) => claim.routes);
}

/**
 * One problem per listed route that no api serves and the allow-list does not name; none when the check is off.
 * A `HEAD` route the framework adds beside a `GET` route follows that route.
 */
export function frameworkRouteProblems(
  check: FrameworkRouteCheck,
  listed: readonly ListedRoute[],
  contractRoutes: readonly ListedRoute[],
): BootProblem[] {
  if (check.status === "off") return [];

  const reported = new Set<string>();
  const problems: BootProblem[] = [];

  for (const route of listed) {
    const key = `${route.method} ${route.path}`;

    if (reported.has(key) || isServedBy(route, contractRoutes)) continue;

    if (check.allowed.some((allowance) => isAllowedBy(route, allowance))) continue;

    if (route.method === HEAD_METHOD && reported.has(`${GET_METHOD} ${route.path}`)) continue;

    reported.add(key);
    problems.push({
      problem: `the framework route '${key}' is outside the contract and not allow-listed`,
      fix: "allow-list it with a reason in the target entry's 'frameworkRoutes' of seampact.config.yaml, or remove the route",
    });
  }

  return problems;
}

function isServedBy(route: ListedRoute, contractRoutes: readonly ListedRoute[]): boolean {
  const path = normalizedPath(route.path);

  return contractRoutes.some(
    (contractRoute) =>
      methodFollows(route.method, contractRoute.method) &&
      normalizedPath(contractRoute.path) === path,
  );
}

function isAllowedBy(route: ListedRoute, allowance: FrameworkRouteAllowance): boolean {
  if (allowance.method !== undefined && !methodFollows(route.method, allowance.method)) {
    return false;
  }

  return segmentsMatch(segmentsOf(allowance.path), segmentsOf(route.path));
}

// A listed method follows a named one when it is that method, or `HEAD` beside a `GET`.
function methodFollows(listed: string, named: string): boolean {
  const upperNamed = named.toUpperCase();

  return (
    listed === upperNamed ||
    upperNamed === ANY_METHOD ||
    (listed === HEAD_METHOD && upperNamed === GET_METHOD)
  );
}

function segmentsMatch(pattern: readonly string[], path: readonly string[]): boolean {
  const [first, ...rest] = pattern;

  if (first === undefined) return path.length === 0;

  if (first === ANY_SEGMENTS) {
    return (
      path.some((_, index) => segmentsMatch(rest, path.slice(index))) || segmentsMatch(rest, [])
    );
  }

  const [segment, ...pathRest] = path;

  if (segment === undefined) return false;

  return (first === ONE_SEGMENT || first === segment) && segmentsMatch(rest, pathRest);
}

function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

// Each framework writes a path param its own way (`:id`, `{id}`, `*rest`); the check compares their places only.
function normalizedPath(path: string): string {
  return segmentsOf(path)
    .map((segment) => (/^[:{*]/.test(segment) ? PARAM_SEGMENT : segment))
    .join("/");
}
