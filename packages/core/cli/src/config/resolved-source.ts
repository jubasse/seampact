import { resolve } from "node:path";
import type { AppSource, BundleSource } from "@seampact/spec/config";

// A `path` source with its absolute workspace directory, or a bundle source as the config writes it.
export type ResolvedSource =
  | { kind: "path"; directory: string }
  | { kind: "bundle"; bundle: BundleSource };

// A `path` source resolved against the directory of the config file that writes it.
export function resolvedSource(directory: string, source: AppSource): ResolvedSource {
  if ("path" in source) return { kind: "path", directory: resolve(directory, source.path) };

  return { kind: "bundle", bundle: structuredClone(source) };
}

export function resolvedSources(
  directory: string,
  sources: Readonly<Record<string, AppSource>> | undefined,
): Map<string, ResolvedSource> {
  return new Map(
    Object.entries(sources ?? {}).map(([name, source]) => [
      name,
      resolvedSource(directory, source),
    ]),
  );
}
