// The boot variants of the sample app (ADR 0015 "Boot tests") and how a boot process tells the runner it started.
// A sample app in any language implements the same variants under the same names.

/**
 * Each misconfiguration a boot case starts the sample app with:
 * - `missing-authenticate-hook`: the `tasks` api registers no authenticate hook for the identity `user`;
 * - `missing-decider`: the `tasks` api registers no decider at all;
 * - `missing-scope-resolver`: the `tasks` api registers no scope resolver for the scope `channel`;
 * - `missing-handler`: the app binds no handler for the `tasks` api's `health` operation (the `AppEndpoints`
 *   interface);
 * - `unlisted-framework-route`: the app serves `GET /v1/unlisted`, a framework route outside the contract that
 *   its config does not allow-list;
 * - `allow-listed-framework-route`: the same route, allow-listed in the config with a reason.
 */
export const BOOT_VARIANTS = [
  "missing-authenticate-hook",
  "missing-decider",
  "missing-scope-resolver",
  "missing-handler",
  "unlisted-framework-route",
  "allow-listed-framework-route",
] as const;

export type BootVariant = (typeof BOOT_VARIANTS)[number];

/** The profile name of the boot cases, in the case files and the suite report. */
export const BOOT_PROFILE = "boot";

/** The environment variable a boot process reads its variant from; unset, the sample app boots as configured. */
export const BOOT_VARIANT_ENV = "SEAMPACT_SUITE_BOOT_VARIANT";

/** The line a boot process writes to its standard output once the app has started, before it exits with 0. */
export const BOOT_STARTED_LINE = "seampact-suite: started";

export function isBootVariant(value: string): value is BootVariant {
  return BOOT_VARIANTS.some((variant) => variant === value);
}

/** The variant named by a boot process's environment, `undefined` when it names none; an unknown name throws. */
export function bootVariantOf(
  environment: Readonly<Record<string, string | undefined>>,
): BootVariant | undefined {
  const value = environment[BOOT_VARIANT_ENV];

  if (value === undefined || value === "") return undefined;

  if (!isBootVariant(value)) {
    throw new Error(
      `http-suite: ${BOOT_VARIANT_ENV}='${value}' names no boot variant; use one of ${BOOT_VARIANTS.join(", ")}`,
    );
  }

  return value;
}
