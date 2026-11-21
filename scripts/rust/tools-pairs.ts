import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadOracleContext } from "../oracle/expected.ts";
import { readExcluded } from "../oracle/fixtures.ts";
import { discoverTargets } from "../oracle/targets.ts";
import { OPENAPI_OPTIONS_FILE, readCaseJson, toolCaseFiles } from "../oracle/tool-cases.ts";
import { diffTableText } from "../oracle/tool-diff.ts";
import { openApiFiles } from "../oracle/tool-openapi.ts";
import type { CoverageProbe, ReachedFunction } from "./pass-coverage.ts";

// One record per oracle case, per tool: what running the case's writer reached (`CoverageProbe.take`). The `tools-coverage`
// tables read them as pairs. A CLI case is one record for the `cli` crate and for the units it calls (`cli-config`,
// `editor-schemas`, `bundle-fetch`): the whole run, not only the recorded calls.

export interface ToolRecords {
  /** Every fixture api emitted, every converted IR and every merge case. */
  openapi: ReachedFunction[][];
  lint: ReachedFunction[][];
  "diff-table": ReachedFunction[][];
  diff: ReachedFunction[][];
  bundle: ReachedFunction[][];
  /** The CLI cases; also the pairs of `bundle-fetch`, `cli-config` and `editor-schemas`. */
  cli: ReachedFunction[][];
}

export async function collectToolRecords(probe: CoverageProbe): Promise<ToolRecords> {
  const context = await loadOracleContext();
  const { compiler, tools, cache } = context;
  const excluded = readExcluded();
  const records: ToolRecords = {
    openapi: [],
    lint: [],
    "diff-table": [],
    diff: [],
    bundle: [],
    cli: [],
  };

  for (const { fixture, tool } of discoverTargets()) {
    if (fixture !== undefined && excluded.fixtures[fixture.path] === undefined) {
      const { apis } = compiler.compile(fixture.directory, fixture.entry);
      const optionsFile = join(fixture.directory, OPENAPI_OPTIONS_FILE);
      const rawOptions = existsSync(optionsFile)
        ? readCaseJson(fixture.directory, OPENAPI_OPTIONS_FILE)
        : undefined;

      for (const { api, irText, lintInput } of apis) {
        if (irText === undefined) continue;

        probe.take();
        openApiFiles(tools, api, irText, rawOptions);
        records.openapi.push(probe.take());

        if (lintInput === undefined) continue;

        probe.take();
        await tools.runLint({ ...lintInput, plugins: [] });
        records.lint.push(probe.take());
      }
    }

    if (tool === undefined) continue;

    // The compilations a merge or a diff case reads run once before the probe, so they do not count as its work.
    if (tool.kind === "merge" || tool.kind === "diff") await toolCaseFiles(tools, cache, tool);

    probe.take();
    await toolCaseFiles(tools, cache, tool);

    const reached = probe.take();
    const unit = tool.kind === "merge" || tool.kind === "openapi" ? "openapi" : tool.kind;

    records[unit].push(reached);
  }

  probe.take();
  diffTableText(tools);
  records["diff-table"].push(probe.take());

  return records;
}
