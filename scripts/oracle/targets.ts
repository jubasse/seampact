import { discoverFixtures, type OracleFixture } from "./fixtures.ts";
import { discoverToolCases, type ToolCase } from "./tool-cases.ts";

// What the oracle writes expected files for: a fixture, a tool case, or both (a bundle case is also a fixture).

export interface OracleTarget {
  /** The path under `fixtures/`; the expected files sit under `fixtures/expected/<path>/`. */
  path: string;
  directory: string;
  fixture?: OracleFixture;
  tool?: ToolCase;
}

// UTF-16 code unit order, as the compiler sorts.
const byCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export function discoverTargets(): OracleTarget[] {
  const targets = new Map<string, OracleTarget>();

  for (const fixture of discoverFixtures())
    targets.set(fixture.path, { path: fixture.path, directory: fixture.directory, fixture });

  for (const tool of discoverToolCases())
    targets.set(tool.path, {
      ...targets.get(tool.path),
      path: tool.path,
      directory: tool.directory,
      tool,
    });

  return [...targets.values()].sort((left, right) => byCodeUnits(left.path, right.path));
}
