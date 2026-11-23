import { existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OracleTools } from "./tool-modules.ts";

// The probe generators' TypeScript twins (`fixtures/generators/probe-*/`), linked into a CLI case's root as installed
// packages. The twins read `defineTarget`, Prettier's `format` and the IR version from the global below.

const GENERATORS_ROOT = fileURLToPath(new URL("../../fixtures/generators", import.meta.url));
const PROBE_PREFIX = "probe-";
const PROBE_GLOBAL = "seampactOracleProbe";

function probeIds(): string[] {
  return readdirSync(GENERATORS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(PROBE_PREFIX))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Links each probe into `<root>/node_modules/<id>`, leaving a package the case's tree already holds alone, and
 * returns the root-relative paths it linked.
 */
export function linkProbeGenerators(tools: OracleTools, root: string): string[] {
  Reflect.set(globalThis, PROBE_GLOBAL, tools.probe);

  const linked: string[] = [];

  for (const id of probeIds()) {
    const link = join(root, "node_modules", id);

    if (existsSync(link)) continue;

    mkdirSync(join(root, "node_modules"), { recursive: true });
    symlinkSync(join(GENERATORS_ROOT, id), link, "dir");
    linked.push(`node_modules/${id}`);
  }

  return linked;
}
