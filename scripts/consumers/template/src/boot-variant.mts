// The boot variant this process of the sample app starts with, read from its environment (ADR 0015 "Boot tests"):
// the hooks and each overlay's registration leave out what the variant names, so the boot check refuses to start.
import {
  BOOT_APP_OF_VARIANT,
  type BootApp,
  type BootVariant,
  bootVariantOf,
} from "@seampact/http-suite";

export const BOOT_VARIANT: BootVariant | undefined = bootVariantOf(process.env);

/** The handler interface the `missing-handler` variant leaves out: `AppEndpoints`, the `health` operation's. */
export const MISSING_HANDLER_INTERFACE = "AppEndpoints";

/** The framework route outside the contract the framework-route variants serve. */
export const UNLISTED_ROUTE = "/v1/unlisted";

/** The framework route the `pattern-allow-listed-framework-route` variant serves, allow-listed by `/v1/patterned/**`. */
export const PATTERNED_ROUTE = "/v1/patterned/one/two";

/** The framework prefix the `mount-mismatch` variant serves the `tasks` api under; its entry states no mount. */
export const MISMATCHED_MOUNT = "/mounted";

/** Where a boot variant loads generated server modules from in place of `from`: directories under the consumer. */
export interface ServerRedirect {
  readonly from: string;
  readonly to: string;
}

const GENERATED_SERVER_DIRECTORY = "generated/server";

// The generated server of each app built from another entry of the overlay's config: `server-allow-listed`, whose
// config allow-lists `UNLISTED_ROUTE`; `server-route-check-off`, every api with the framework-route check off; and
// `server-hook-check-off`, the `tasks` api only, with the hook check off and the `health` operation filtered out.
const SERVER_REDIRECT_OF_APP: Readonly<Record<BootApp, ServerRedirect>> = {
  "allow-listed": { from: GENERATED_SERVER_DIRECTORY, to: "generated/server-allow-listed" },
  "route-check-off": { from: GENERATED_SERVER_DIRECTORY, to: "generated/server-route-check-off" },
  "hook-check-off": {
    from: `${GENERATED_SERVER_DIRECTORY}/tasks`,
    to: "generated/server-hook-check-off/tasks",
  },
};

// The variants that leave out the member another variant names, on the server their own entry generates.
const LEAVES_OUT_AS: Readonly<Partial<Record<BootVariant, BootVariant>>> = {
  "framework-route-check-off-missing-hook": "missing-authenticate-hook",
  "hook-check-off": "missing-authenticate-hook",
};

export function bootVariantIs(variant: BootVariant): boolean {
  return BOOT_VARIANT === variant;
}

/** Where this process loads generated server modules from in place of `generated/server`, if its variant says. */
export function variantServerRedirect(): ServerRedirect | undefined {
  const app = BOOT_VARIANT === undefined ? undefined : BOOT_APP_OF_VARIANT[BOOT_VARIANT];

  return app === undefined ? undefined : SERVER_REDIRECT_OF_APP[app];
}

/** Whether the app serves `UNLISTED_ROUTE`: under each variant that checks that route. */
export function servesUnlistedRoute(): boolean {
  return (
    bootVariantIs("unlisted-framework-route") ||
    bootVariantIs("allow-listed-framework-route") ||
    bootVariantIs("framework-route-check-off") ||
    bootVariantIs("hook-check-off-unlisted-route")
  );
}

/** Whether the app serves `PATTERNED_ROUTE`. */
export function servesPatternedRoute(): boolean {
  return bootVariantIs("pattern-allow-listed-framework-route");
}

/** Whether the app serves the `tasks` api under `MISMATCHED_MOUNT`. */
export function mountsUnderMismatchedPrefix(): boolean {
  return bootVariantIs("mount-mismatch");
}

/** Whether the app binds no handler for the `health` operation: missing, or filtered out of the generated server. */
export function leavesOutHealthHandler(): boolean {
  const app = BOOT_VARIANT === undefined ? undefined : BOOT_APP_OF_VARIANT[BOOT_VARIANT];

  return bootVariantIs("missing-handler") || app === "hook-check-off";
}

// The return type keeps `member` on purpose: under the variant the member is missing at runtime by design.
/** A copy of `object`, without `member` when this process runs `variant` or a variant that leaves out the same. */
export function withoutMemberUnder<Value extends object>(
  variant: BootVariant,
  object: Value,
  member: string,
): Value {
  const copy = { ...object };

  if (leavesOut(variant)) Reflect.deleteProperty(copy, member);

  return copy;
}

/** The handlers or controllers by interface, without `AppEndpoints` when `leavesOutHealthHandler()`. */
export function withoutMissingHandler<Handlers extends object>(handlers: Handlers): Handlers {
  const copy = { ...handlers };

  if (leavesOutHealthHandler()) Reflect.deleteProperty(copy, MISSING_HANDLER_INTERFACE);

  return copy;
}

function leavesOut(variant: BootVariant): boolean {
  return (
    BOOT_VARIANT !== undefined &&
    (BOOT_VARIANT === variant || LEAVES_OUT_AS[BOOT_VARIANT] === variant)
  );
}
