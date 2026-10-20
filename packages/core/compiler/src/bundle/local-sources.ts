// Refusing local sources on shared branches (ADR 0011): `allowLocal` in the config, true when absent, and the
// environment variable `SEAMPACT_ALLOW_LOCAL`, whose `false` forces the refusal and whose other values never lift a
// `false` the config holds.

export type LocalSourcePolicy = "allow" | "refuse";

export const ALLOW_LOCAL_VARIABLE = "SEAMPACT_ALLOW_LOCAL";

const FORCED_REFUSAL = "false";

/** The policy of a config whose `allowLocal` is `configured`, under the environment `env`. */
export function localSourcePolicy(
  configured: boolean | undefined,
  env: Readonly<Record<string, string | undefined>>,
): LocalSourcePolicy {
  if (env[ALLOW_LOCAL_VARIABLE] === FORCED_REFUSAL || configured === false) return "refuse";

  return "allow";
}

/** Which setting refuses local sources, for a message: the environment variable wins. */
export function localSourceRefusalReason(
  env: Readonly<Record<string, string | undefined>>,
): string {
  return env[ALLOW_LOCAL_VARIABLE] === FORCED_REFUSAL
    ? `${ALLOW_LOCAL_VARIABLE}=${FORCED_REFUSAL}`
    : "allowLocal: false";
}
