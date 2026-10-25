import {
  type FrontQueryOptions,
  type ParseOptionsOutcome,
  parseFrontQueryOptions,
  type Refusal,
} from "@seampact/codegen-core";

// The angular target's options (ADR 0021 "Options, artefacts and their defaults"): the query library, which is
// required, the switches every front target shares, and the opt-in `state`. Only `fetch` is generated yet: signal
// readers built on Angular's `resource()`, with no cache. `state: ngrx` adds NgRx action groups and effects over the
// service, `state: ngrx-signals` a Signal Store feature per operation.

export const QUERY_LIBRARIES = ["fetch"] as const;

export type QueryLibrary = (typeof QUERY_LIBRARIES)[number];

const STATE_VALUES = ["ngrx", "ngrx-signals"] as const;

/** The state library the generated code feeds, when the app opts in. */
export type StateLibrary = (typeof STATE_VALUES)[number];

export interface AngularOwnOptions {
  // Absent, no state code is generated.
  state?: StateLibrary;
}

export type AngularQueryOptions = FrontQueryOptions<QueryLibrary> & AngularOwnOptions;

const STATE_KEY = "state";

/** Parses the options, every unknown key or value and a missing `query` refused by name. */
export function parseAngularQueryOptions(raw: unknown): ParseOptionsOutcome<AngularQueryOptions> {
  return parseFrontQueryOptions(raw, {
    libraries: QUERY_LIBRARIES,
    noCacheLibrary: "fetch",
    ownKeys: [STATE_KEY],
    readOwnOptions: readStateOption,
    refuseUnsupportedPairs: () => [],
  });
}

function readStateOption(
  raw: Readonly<Record<string, unknown>>,
  refusals: Refusal[],
): AngularOwnOptions {
  if (!Object.hasOwn(raw, STATE_KEY)) return {};

  const value = raw[STATE_KEY];
  const state = STATE_VALUES.find((each) => each === value);

  if (state !== undefined) return { state };

  refusals.push({
    code: "options.state.invalid",
    message: `The option 'state' is ${JSON.stringify(value)}, not one of ${STATE_VALUES.join(", ")}.`,
    fix: "Write 'state: ngrx' or 'state: ngrx-signals', or drop 'state'.",
    member: `/${STATE_KEY}`,
  });

  return {};
}
