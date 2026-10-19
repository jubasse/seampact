// The framework-route boot check of a server target entry (ADR 0012 "The boot check", ADR 0011 "The app config"):
// the routes outside the contract the app config allow-lists, each with its reason, or the check switched off.

/** One `frameworkRoutes` entry: a path or a pattern (`*` one segment, `**` any number), an optional method. */
export interface FrameworkRouteAllowance {
  readonly method?: string;
  readonly path: string;
  readonly reason: string;
}

/** The check as the target entry asks it: on with its allow-list, or off (`artefacts.bootCheck.frameworkRoutes`). */
export type FrameworkRouteCheck =
  | { readonly status: "on"; readonly allowed: readonly FrameworkRouteAllowance[] }
  | { readonly status: "off" };

/** The check of an entry that writes neither key: on, with nothing allow-listed. */
export const DEFAULT_FRAMEWORK_ROUTE_CHECK: FrameworkRouteCheck = { status: "on", allowed: [] };

/** The boot checks a target generates that an app config entry may tune; a server target declares them. */
export type TunableBootCheck = "frameworkRoutes";
