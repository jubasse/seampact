// The boot variant this process of the sample app starts with, read from its environment (ADR 0015 "Boot tests"):
// the hooks and each overlay's registration leave out what the variant names, so the boot check refuses to start.
import { type BootVariant, bootVariantOf } from "@seampact/http-suite";

// The Node targets have no check of framework routes outside the contract yet, and the CLI refuses the
// `frameworkRoutes` entry an allow-list needs, so the sample app cannot run these variants.
const UNSUPPORTED_VARIANTS: readonly BootVariant[] = [
  "unlisted-framework-route",
  "allow-listed-framework-route",
];

export const BOOT_VARIANT: BootVariant | undefined = supportedBootVariant();

/** The handler interface the `missing-handler` variant leaves out: `AppEndpoints`, the `health` operation's. */
export const MISSING_HANDLER_INTERFACE = "AppEndpoints";

export function bootVariantIs(variant: BootVariant): boolean {
  return BOOT_VARIANT === variant;
}

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

function supportedBootVariant(): BootVariant | undefined {
  const variant = bootVariantOf(process.env);

  if (variant !== undefined && UNSUPPORTED_VARIANTS.includes(variant)) {
    throw new Error(
      `the Node sample app cannot run the boot variant '${variant}': the Node targets have no framework-route boot check and the CLI refuses 'frameworkRoutes'`,
    );
  }

  return variant;
}
