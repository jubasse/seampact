// The pack profile of a consumer app that serves the reference contract with a first-party pack applied: read from
// the golden IRs of both apis under `fixtures/golden/<pack>`, the api that applies the pack first.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContractIR } from "../../packages/core/spec/src/ir/index.ts";
import { type PackProfile, packProfileOf } from "../../packages/tools/http-suite/src/index.ts";

const GOLDEN_DIRECTORY = join(import.meta.dirname, "../../fixtures/golden");

function goldenIr(pack: string, api: string): ContractIR {
  return JSON.parse(readFileSync(join(GOLDEN_DIRECTORY, pack, `${api}.ir.json`), "utf8"));
}

/** The profile of [pack] (`pack-laravel`) over the golden `tasks` and `tasksService` IRs. */
export function goldenPackProfile(pack: string): PackProfile {
  return packProfileOf(
    [goldenIr(pack, "tasks"), goldenIr(pack, "tasksService")],
    `@seampact/${pack}`,
  );
}
