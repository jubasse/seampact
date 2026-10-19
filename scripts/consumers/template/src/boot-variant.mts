// The boot variant this process of the sample app starts with, read from its environment (ADR 0015 "Boot tests"):
// the hooks and each overlay's registration leave out what the variant names, so the boot check refuses to start.
import { type BootVariant, bootVariantOf } from "@seampact/http-suite";

export const BOOT_VARIANT: BootVariant | undefined = bootVariantOf(process.env);

/** The handler interface the `missing-handler` variant leaves out: `AppEndpoints`, the `health` operation's. */
export const MISSING_HANDLER_INTERFACE = "AppEndpoints";

/** The framework route outside the contract the two framework-route variants serve. */
export const UNLISTED_ROUTE = "/v1/unlisted";

/**
 * The generated server directory the `allow-listed-framework-route` variant loads in place of `generated/server`:
 * the overlay's `server-allow-listed` entry, whose config allow-lists `UNLISTED_ROUTE`.
 */
export const ALLOW_LISTED_SERVER_DIRECTORY = "generated/server-allow-listed";

export function bootVariantIs(variant: BootVariant): boolean {
  return BOOT_VARIANT === variant;
}

/** Whether the app serves `UNLISTED_ROUTE`: under either framework-route variant. */
export function servesUnlistedRoute(): boolean {
  return bootVariantIs("unlisted-framework-route") || bootVariantIs("allow-listed-framework-route");
}

// The return type keeps `member` on purpose: under the variant the member is missing at runtime by design.
/** A copy of `object`, without `member` when this process runs `variant`. */
export function withoutMemberUnder<Value extends object>(
  variant: BootVariant,
  object: Value,
  member: string,
): Value {
  const copy = { ...object };

  if (bootVariantIs(variant)) Reflect.deleteProperty(copy, member);

  return copy;
}

/** The handlers or controllers by interface, without `AppEndpoints` under the `missing-handler` variant. */
export function withoutMissingHandler<Handlers extends object>(handlers: Handlers): Handlers {
  return withoutMemberUnder("missing-handler", handlers, MISSING_HANDLER_INTERFACE);
}
