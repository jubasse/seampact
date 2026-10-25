import {
  type FrontQueryOptions,
  type ParseOptionsOutcome,
  parseFrontQueryOptions,
  type Refusal,
} from "@seampact/codegen-core";

// The angular target's options (ADR 0021 "Options, artefacts and their defaults"): the query library, which is
// required, the switches every front target shares, and the opt-in `state`. Only `fetch` is generated yet: signal
// readers built on Angular's `resource()`, with no cache. `state: ngrx` adds NgRx action groups and effects over the
// service; `state: ngrx-signals` (a Signal Store feature) is known by name and refused until it is generated.

export const QUERY_LIBRARIES = ["fetch"] as const;

export type QueryLibrary = (typeof QUERY_LIBRARIES)[number];

/** The state library the generated code feeds, when the app opts in. */
export type StateLibrary = "ngrx";

export interface AngularOwnOptions {
  // Absent, no state code is generated.
  state?: StateLibrary;
}

export type AngularQueryOptions = FrontQueryOptions<QueryLibrary> & AngularOwnOptions;

const STATE_KEY = "state";
const GENERATED_STATE_VALUES: readonly StateLibrary[] = ["ngrx"];
const WAITING_STATE_VALUES = ["ngrx-signals"];
const STATE_VALUES = [...GENERATED_STATE_VALUES, ...WAITING_STATE_VALUES];

/** Parses the options, every unknown key or value, a missing `query` and the waiting `state` refused by name. */
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
  const member = `/${STATE_KEY}`;
  const generated = GENERATED_STATE_VALUES.find((each) => each === value);

  if (generated !== undefined) return { state: generated };

  if (typeof value === "string" && WAITING_STATE_VALUES.includes(value)) {
    refusals.push({
      code: "options.state.unsupported",
      message: `The option 'state: ${value}' is not generated yet: the angular target generates 'state: ngrx' only.`,
      fix: "Use 'state: ngrx', or drop 'state' and keep the app's state in its own store, fed by the generated readers.",
      member,
    });

    return {};
  }

  refusals.push({
    code: "options.state.invalid",
    message: `The option 'state' is ${JSON.stringify(value)}, not one of ${STATE_VALUES.join(", ")}.`,
    fix: "Write 'state: ngrx', or drop 'state'.",
    member,
  });

  return {};
}
