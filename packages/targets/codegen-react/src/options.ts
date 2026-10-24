import { below, type ParseOptionsOutcome, type Refusal } from "@seampact/codegen-core";

// The react target's options (ADR 0021 "Options, artefacts and their defaults"): the query library, which is
// required, and the switches that turn off each behaviour shaping the app's cache or data.

// `fetch` is no library: hooks built on React's own state and effects, with no cache.
export const QUERY_LIBRARIES = ["tanstack", "swr", "rtk", "fetch"] as const;

export type QueryLibrary = (typeof QUERY_LIBRARIES)[number];

export interface ReactQueryOptions {
  query: QueryLibrary;
  // Declared errors thrown into the library's error state, or the whole result returned as data.
  errors: "throw" | "data";
  invalidate: "resource" | "off";
  staleTime: "off" | "contract";
  infinite: "on" | "off";
  useClientDirective: "on" | "off";
  // The first key segment; the api id when absent.
  keysRoot?: string;
}

// Each switch, its values in order, the first being the default.
const SWITCHES = {
  errors: ["throw", "data"],
  invalidate: ["resource", "off"],
  staleTime: ["off", "contract"],
  infinite: ["on", "off"],
  useClientDirective: ["on", "off"],
} as const;

type SwitchKey = keyof typeof SWITCHES;

const SWITCH_KEYS: readonly SwitchKey[] = [
  "errors",
  "invalidate",
  "staleTime",
  "infinite",
  "useClientDirective",
];
const QUERY_KEY = "query";
const KEYS_KEY = "keys";
const ROOT_KEY = "root";
const KNOWN_KEYS: readonly string[] = [QUERY_KEY, ...SWITCH_KEYS, KEYS_KEY];
const OPTIONS_LOCATION = { member: "" };

// The libraries `staleTime: contract` has no per-query place in (ADR 0021 "SWR", "RTK Query").
const NO_STALE_TIME: readonly QueryLibrary[] = ["swr", "rtk"];
const RTK: QueryLibrary = "rtk";
const FETCH: QueryLibrary = "fetch";
// The options only a query library's cache gives a meaning to (ADR 0021 "Plain fetch").
const CACHE_ONLY_SWITCHES: readonly SwitchKey[] = ["staleTime", "invalidate", "infinite"];

/** Parses the options, every unknown key or value, a missing `query` and each unsupported pair refused by name. */
export function parseReactQueryOptions(raw: unknown): ParseOptionsOutcome<ReactQueryOptions> {
  if (!isRecord(raw)) {
    return refused([
      {
        code: "options.invalid",
        message: "The target options are not an object.",
        fix: `Write the target's \`options\` as an object with a \`query\` library: ${QUERY_LIBRARIES.join(", ")}.`,
        member: "",
      },
    ]);
  }

  const refusals = Object.keys(raw)
    .filter((key) => !KNOWN_KEYS.includes(key))
    .map(refuseUnknownOption);
  const query = queryLibraryOf(raw, refusals);
  const switches = switchValues(raw, refusals);
  const keysRoot = keysRootOf(raw, refusals);

  if (query === FETCH) refuseCacheOptions(raw, keysRoot, refusals);
  else if (query !== undefined) refuseUnsupportedPairs(query, switches, keysRoot, refusals);

  if (refusals.length > 0 || query === undefined) return refused(refusals);

  // Plain fetch has no cache to refresh and no infinite hook.
  const librarySwitches: SwitchValues =
    query === FETCH ? { ...switches, invalidate: "off", infinite: "off" } : switches;

  return {
    status: "parsed",
    options: { query, ...librarySwitches, ...(keysRoot === undefined ? {} : { keysRoot }) },
  };
}

// With `query: fetch` there is no cache: freshness, invalidation, infinite queries and keys are refused when set.
function refuseCacheOptions(
  raw: Readonly<Record<string, unknown>>,
  keysRoot: string | undefined,
  refusals: Refusal[],
): void {
  for (const key of CACHE_ONLY_SWITCHES.filter((each) => Object.hasOwn(raw, each))) {
    refusals.push({
      code: `options.${key}.unsupported`,
      message: `The option '${key}' needs a query library's cache, which 'query: fetch' has not.`,
      fix: `Drop '${key}', or choose a query library: ${QUERY_LIBRARIES.filter((each) => each !== FETCH).join(", ")}.`,
      member: below(OPTIONS_LOCATION, key).member,
    });
  }

  if (keysRoot === undefined) return;

  refusals.push({
    code: "options.keys.root.unsupported",
    message:
      "The option 'keys.root' has no meaning with 'query: fetch': plain fetch hooks have no keys.",
    fix: "Drop 'keys.root'.",
    member: below(OPTIONS_LOCATION, KEYS_KEY, ROOT_KEY).member,
  });
}

function queryLibraryOf(
  raw: Readonly<Record<string, unknown>>,
  refusals: Refusal[],
): QueryLibrary | undefined {
  if (!Object.hasOwn(raw, QUERY_KEY)) {
    refusals.push({
      code: "options.query.missing",
      message: "The option 'query' is missing: the target has no default query library.",
      fix: `Set 'query' to one of ${QUERY_LIBRARIES.join(", ")}.`,
      member: below(OPTIONS_LOCATION, QUERY_KEY).member,
    });

    return undefined;
  }

  const value = raw[QUERY_KEY];
  const library = QUERY_LIBRARIES.find((each) => each === value);

  if (library === undefined) refusals.push(refuseInvalidValue(QUERY_KEY, value, QUERY_LIBRARIES));

  return library;
}

type SwitchValues = Pick<ReactQueryOptions, SwitchKey>;

function switchValues(raw: Readonly<Record<string, unknown>>, refusals: Refusal[]): SwitchValues {
  return {
    errors: switchValue(raw, "errors", refusals),
    invalidate: switchValue(raw, "invalidate", refusals),
    staleTime: switchValue(raw, "staleTime", refusals),
    infinite: switchValue(raw, "infinite", refusals),
    useClientDirective: switchValue(raw, "useClientDirective", refusals),
  };
}

// The value of a switch, its default when absent; an invalid value is refused and stands as the default.
function switchValue<Key extends SwitchKey>(
  raw: Readonly<Record<string, unknown>>,
  key: Key,
  refusals: Refusal[],
): (typeof SWITCHES)[Key][number] {
  const values: readonly (typeof SWITCHES)[Key][number][] = SWITCHES[key];
  const [defaultValue] = SWITCHES[key];

  if (!Object.hasOwn(raw, key)) return defaultValue;

  const value = values.find((each) => each === raw[key]);

  if (value !== undefined) return value;

  refusals.push(refuseInvalidValue(key, raw[key], values));

  return defaultValue;
}

// `keys: { root: <string> }`; any other member of `keys` is refused by name.
function keysRootOf(
  raw: Readonly<Record<string, unknown>>,
  refusals: Refusal[],
): string | undefined {
  if (!Object.hasOwn(raw, KEYS_KEY)) return undefined;

  const keys = raw[KEYS_KEY];
  const keysLocation = below(OPTIONS_LOCATION, KEYS_KEY);

  if (!isRecord(keys)) {
    refusals.push({
      code: "options.keys.invalid",
      message: "The option 'keys' is not an object.",
      fix: "Write 'keys' as `{ root: <name> }`, or leave it out.",
      member: keysLocation.member,
    });

    return undefined;
  }

  for (const key of Object.keys(keys).filter((each) => each !== ROOT_KEY)) {
    refusals.push({
      code: "options.unknown",
      message: `The option 'keys.${key}' is not one this target knows; 'keys' takes 'root' only.`,
      fix: `Remove '${key}' from 'keys'.`,
      member: below(keysLocation, key).member,
    });
  }

  const root = keys[ROOT_KEY];

  if (root === undefined) return undefined;

  if (typeof root === "string" && root !== "") return root;

  refusals.push({
    code: "options.keys.root.invalid",
    message: `The option 'keys.root' is ${JSON.stringify(root)}, not a non-empty string.`,
    fix: "Set 'keys.root' to the name the first key segment takes, or leave it out for the api id.",
    member: below(keysLocation, ROOT_KEY).member,
  });

  return undefined;
}

function refuseUnsupportedPairs(
  query: QueryLibrary,
  switches: SwitchValues,
  keysRoot: string | undefined,
  refusals: Refusal[],
): void {
  if (switches.staleTime === "contract" && NO_STALE_TIME.includes(query)) {
    refusals.push({
      code: "options.staleTime.unsupported",
      message: `The option 'staleTime: contract' has no per-query place with 'query: ${query}'.`,
      fix: "Drop 'staleTime: contract', or set the library's own freshness setting in the app.",
      member: below(OPTIONS_LOCATION, "staleTime").member,
    });
  }

  if (keysRoot !== undefined && query === RTK) {
    refusals.push({
      code: "options.keys.root.unsupported",
      message: "The option 'keys.root' has no meaning with 'query: rtk': RTK Query has no keys.",
      fix: "Drop 'keys.root'.",
      member: below(OPTIONS_LOCATION, KEYS_KEY, ROOT_KEY).member,
    });
  }
}

function refuseInvalidValue(key: string, value: unknown, values: readonly string[]): Refusal {
  return {
    code: `options.${key}.invalid`,
    message: `The option '${key}' is ${JSON.stringify(value)}, not one of ${values.join(", ")}.`,
    fix: `Set '${key}' to one of ${values.join(", ")}.`,
    member: below(OPTIONS_LOCATION, key).member,
  };
}

function refuseUnknownOption(key: string): Refusal {
  return {
    code: "options.unknown",
    message: `The option '${key}' is not one this target knows; it takes ${KNOWN_KEYS.join(", ")}.`,
    fix: `Remove '${key}' from the target's \`options\`.`,
    member: below(OPTIONS_LOCATION, key).member,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refused(refusals: Refusal[]): ParseOptionsOutcome<ReactQueryOptions> {
  return { status: "refused", refusals };
}
