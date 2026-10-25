import {
  type FrontQueryOptions,
  type ParseOptionsOutcome,
  parseFrontQueryOptions,
  type Refusal,
} from "@seampact/codegen-core";

// The angular target's options (ADR 0021 "Options, artefacts and their defaults"): the query library, which is
// required, and the switches every front target shares. Only `fetch` is generated yet: signal readers built on
// Angular's `resource()`, with no cache. `state` (NgRx action groups and effects, or a Signal Store feature) is
// known by name and refused until it is generated.

export const QUERY_LIBRARIES = ["fetch"] as const;

export type QueryLibrary = (typeof QUERY_LIBRARIES)[number];

export type AngularQueryOptions = FrontQueryOptions<QueryLibrary>;

const STATE_KEY = "state";
const STATE_VALUES = ["ngrx", "ngrx-signals"];

/** Parses the options, every unknown key or value, a missing `query` and the waiting `state` refused by name. */
export function parseAngularQueryOptions(raw: unknown): ParseOptionsOutcome<AngularQueryOptions> {
  return parseFrontQueryOptions(raw, {
    libraries: QUERY_LIBRARIES,
    noCacheLibrary: "fetch",
    ownKeys: [STATE_KEY],
    readOwnOptions: refuseWaitingState,
    refuseUnsupportedPairs: () => [],
  });
}

function refuseWaitingState(raw: Readonly<Record<string, unknown>>, refusals: Refusal[]): object {
  if (!Object.hasOwn(raw, STATE_KEY)) return {};

  const value = raw[STATE_KEY];
  const member = `/${STATE_KEY}`;

  if (typeof value === "string" && STATE_VALUES.includes(value)) {
    refusals.push({
      code: "options.state.unsupported",
      message: `The option 'state: ${value}' is not generated yet: the angular target has no state code.`,
      fix: "Drop 'state'; keep the app's state in its own store, fed by the generated readers.",
      member,
    });

    return {};
  }

  refusals.push({
    code: "options.state.invalid",
    message: `The option 'state' is ${JSON.stringify(value)}, not one of ${STATE_VALUES.join(", ")}.`,
    fix: "Drop 'state'.",
    member,
  });

  return {};
}
