import { below } from "../ir-location.js";
import type { Refusal } from "../refusal.js";
import type { ParseOptionsOutcome } from "../target.js";

// The options every front query target reads (ADR 0021 "Options, artefacts and their defaults"): the query library,
// which is required, the switches that turn off each behaviour shaping the app's cache or data, and `keys.root`.
// Each target names its libraries, its own option keys, and the pairs it refuses.

/** A front target's parsed common options: the library, every switch, and the first key segment when renamed. */
export interface FrontQueryOptions<Library extends string> {
  query: Library;
  // Declared errors thrown into the library's error state, or the whole result returned as data.
  errors: "throw" | "data";
  invalidate: "resource" | "off";
  staleTime: "off" | "contract";
  infinite: "on" | "off";
  // The first key segment; the api id when absent.
  keysRoot?: string;
}

/** The common switches' values. */
export type SwitchSettings = Omit<FrontQueryOptions<string>, "query" | "keysRoot">;

/** What a front target's options parser is built from. */
export interface FrontQueryOptionsSpec<Library extends string, Own extends object> {
  readonly libraries: readonly Library[];
  // The value with no query library: its hooks have no cache, so the cache switches and keys are refused.
  readonly noCacheLibrary: Library;
  // The target's own option keys, listed after the common switches, and how it reads them (with `switchValue`).
  readonly ownKeys: readonly string[];
  readonly readOwnOptions: (raw: Readonly<Record<string, unknown>>, refusals: Refusal[]) => Own;
  // The pairs of a library and a setting the target refuses, each by name.
  readonly refuseUnsupportedPairs: (
    query: Library,
    switches: SwitchSettings,
    keysRoot: string | undefined,
  ) => Refusal[];
}

const QUERY_KEY = "query";
const KEYS_KEY = "keys";
const ROOT_KEY = "root";
const OPTIONS_LOCATION = { member: "" };

const SWITCH_KEYS: readonly (keyof SwitchSettings)[] = [
  "errors",
  "invalidate",
  "staleTime",
  "infinite",
];
// The options only a query library's cache gives a meaning to (ADR 0021 "Plain fetch").
const CACHE_ONLY_SWITCHES: readonly (keyof SwitchSettings)[] = [
  "staleTime",
  "invalidate",
  "infinite",
];

/** Parses a front target's options, every unknown key or value, a missing `query` and each unsupported pair refused by name. */
export function parseFrontQueryOptions<Library extends string, Own extends object>(
  raw: unknown,
  spec: FrontQueryOptionsSpec<Library, Own>,
): ParseOptionsOutcome<FrontQueryOptions<Library> & Own> {
  if (!isRecord(raw)) {
    return refused([
      {
        code: "options.invalid",
        message: "The target options are not an object.",
        fix: `Write the target's \`options\` as an object with a \`query\` library: ${spec.libraries.join(", ")}.`,
        member: "",
      },
    ]);
  }

  const knownKeys = [QUERY_KEY, ...SWITCH_KEYS, ...spec.ownKeys, KEYS_KEY];
  const refusals = Object.keys(raw)
    .filter((key) => !knownKeys.includes(key))
    .map((key) => refuseUnknownOption(key, knownKeys));
  const query = queryLibraryOf(raw, spec.libraries, refusals);
  const switches: SwitchSettings = {
    errors: switchValue(raw, "errors", ["throw", "data"], refusals),
    invalidate: switchValue(raw, "invalidate", ["resource", "off"], refusals),
    staleTime: switchValue(raw, "staleTime", ["off", "contract"], refusals),
    infinite: switchValue(raw, "infinite", ["on", "off"], refusals),
  };
  const own = spec.readOwnOptions(raw, refusals);
  const keysRoot = keysRootOf(raw, refusals);

  if (query === spec.noCacheLibrary) {
    refuseCacheOptions(raw, keysRoot, spec, refusals);
  } else if (query !== undefined) {
    refusals.push(...spec.refuseUnsupportedPairs(query, switches, keysRoot));
  }

  if (refusals.length > 0 || query === undefined) return refused(refusals);

  // Plain fetch has no cache to refresh and no infinite hook.
  const librarySwitches: SwitchSettings =
    query === spec.noCacheLibrary ? { ...switches, invalidate: "off", infinite: "off" } : switches;

  return {
    status: "parsed",
    options: { query, ...librarySwitches, ...own, ...(keysRoot === undefined ? {} : { keysRoot }) },
  };
}

// Without a query library there is no cache: freshness, invalidation, infinite queries and keys are refused when set.
function refuseCacheOptions<Library extends string>(
  raw: Readonly<Record<string, unknown>>,
  keysRoot: string | undefined,
  spec: { readonly libraries: readonly Library[]; readonly noCacheLibrary: Library },
  refusals: Refusal[],
): void {
  const noCache = spec.noCacheLibrary;
  const libraries = spec.libraries.filter((each) => each !== noCache).join(", ");

  for (const key of CACHE_ONLY_SWITCHES.filter((each) => Object.hasOwn(raw, each))) {
    refusals.push({
      code: `options.${key}.unsupported`,
      message: `The option '${key}' needs a query library's cache, which 'query: ${noCache}' has not.`,
      fix: `Drop '${key}', or choose a query library: ${libraries}.`,
      member: below(OPTIONS_LOCATION, key).member,
    });
  }

  if (keysRoot === undefined) return;

  refusals.push({
    code: "options.keys.root.unsupported",
    message: `The option 'keys.root' has no meaning with 'query: ${noCache}': plain fetch has no keys.`,
    fix: "Drop 'keys.root'.",
    member: below(OPTIONS_LOCATION, KEYS_KEY, ROOT_KEY).member,
  });
}

function queryLibraryOf<Library extends string>(
  raw: Readonly<Record<string, unknown>>,
  libraries: readonly Library[],
  refusals: Refusal[],
): Library | undefined {
  if (!Object.hasOwn(raw, QUERY_KEY)) {
    refusals.push({
      code: "options.query.missing",
      message: "The option 'query' is missing: the target has no default query library.",
      fix: `Set 'query' to one of ${libraries.join(", ")}.`,
      member: below(OPTIONS_LOCATION, QUERY_KEY).member,
    });

    return undefined;
  }

  const value = raw[QUERY_KEY];
  const library = libraries.find((each) => each === value);

  if (library === undefined) refusals.push(refuseInvalidValue(QUERY_KEY, value, libraries));

  return library;
}

/** The value of a switch, its default (the first value) when absent; an invalid value is refused and stands as the default. */
export function switchValue<Value extends string>(
  raw: Readonly<Record<string, unknown>>,
  key: string,
  values: readonly [Value, ...Value[]],
  refusals: Refusal[],
): Value {
  const [defaultValue] = values;

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

function refuseInvalidValue(key: string, value: unknown, values: readonly string[]): Refusal {
  return {
    code: `options.${key}.invalid`,
    message: `The option '${key}' is ${JSON.stringify(value)}, not one of ${values.join(", ")}.`,
    fix: `Set '${key}' to one of ${values.join(", ")}.`,
    member: below(OPTIONS_LOCATION, key).member,
  };
}

function refuseUnknownOption(key: string, knownKeys: readonly string[]): Refusal {
  return {
    code: "options.unknown",
    message: `The option '${key}' is not one this target knows; it takes ${knownKeys.join(", ")}.`,
    fix: `Remove '${key}' from the target's \`options\`.`,
    member: below(OPTIONS_LOCATION, key).member,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refused<Options>(refusals: Refusal[]): ParseOptionsOutcome<Options> {
  return { status: "refused", refusals };
}
