import {
  below,
  type FrontQueryOptions,
  type ParseOptionsOutcome,
  parseFrontQueryOptions,
  type Refusal,
  type SwitchSettings,
  switchValue,
} from "@seampact/codegen-core";

// The react target's options (ADR 0021 "Options, artefacts and their defaults"): the query library, which is
// required, the switches every front target shares, and the `"use client"` line, React's own.

// `fetch` is no library: hooks built on React's own state and effects, with no cache.
export const QUERY_LIBRARIES = ["tanstack", "swr", "rtk", "fetch"] as const;

export type QueryLibrary = (typeof QUERY_LIBRARIES)[number];

interface ReactOwnOptions {
  useClientDirective: "on" | "off";
}

export type ReactQueryOptions = FrontQueryOptions<QueryLibrary> & ReactOwnOptions;

const KEYS_KEY = "keys";
const ROOT_KEY = "root";
const OPTIONS_LOCATION = { member: "" };

// The libraries `staleTime: contract` has no per-query place in (ADR 0021 "SWR", "RTK Query").
const NO_STALE_TIME: readonly QueryLibrary[] = ["swr", "rtk"];
const RTK: QueryLibrary = "rtk";

/** Parses the options, every unknown key or value, a missing `query` and each unsupported pair refused by name. */
export function parseReactQueryOptions(raw: unknown): ParseOptionsOutcome<ReactQueryOptions> {
  return parseFrontQueryOptions(raw, {
    libraries: QUERY_LIBRARIES,
    noCacheLibrary: "fetch",
    ownKeys: ["useClientDirective"],
    readOwnOptions: (options, refusals): ReactOwnOptions => ({
      useClientDirective: switchValue(options, "useClientDirective", ["on", "off"], refusals),
    }),
    refuseUnsupportedPairs,
  });
}

function refuseUnsupportedPairs(
  query: QueryLibrary,
  switches: SwitchSettings,
  keysRoot: string | undefined,
): Refusal[] {
  const refusals: Refusal[] = [];

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

  return refusals;
}
