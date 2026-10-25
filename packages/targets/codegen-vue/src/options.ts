import {
  type FrontQueryOptions,
  type ParseOptionsOutcome,
  parseFrontQueryOptions,
} from "@seampact/codegen-core";

// The vue target's options (ADR 0021 "Options, artefacts and their defaults"): the query library, which is
// required, and the switches every front target shares. Vue has no `"use client"` line and refuses no pair.

// `fetch` is no library: composables built on Vue's own `ref` and `watch`, with no cache.
export const QUERY_LIBRARIES = ["tanstack", "fetch"] as const;

export type QueryLibrary = (typeof QUERY_LIBRARIES)[number];

export type VueQueryOptions = FrontQueryOptions<QueryLibrary>;

/** Parses the options, every unknown key or value and a missing `query` refused by name. */
export function parseVueQueryOptions(raw: unknown): ParseOptionsOutcome<VueQueryOptions> {
  return parseFrontQueryOptions(raw, {
    libraries: QUERY_LIBRARIES,
    noCacheLibrary: "fetch",
    ownKeys: [],
    readOwnOptions: () => ({}),
    refuseUnsupportedPairs: () => [],
  });
}
