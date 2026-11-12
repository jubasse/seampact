import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./fixtures.ts";

// Every diagnostic rule id the compiler can emit, found in its sources: the compiler has no runtime catalogue, so
// the ids are read from where they are declared, three forms, each under the prefix its stage owns:
// - a union type `XRule = | "a" | "b"` (the passes' `report.ts` and `diagnostics.ts`);
// - a `rule: "a"` literal (load and the passes' problem objects);
// - a full `"seampact/<stage>/<rule>"` literal (`validateRules`, `*_RULE` constants).
// The finalize stage's schema and invariant rules are built at run time from the IR schema and are not listed. An id
// found but never emitted shows up as uncovered; the fixtures lane then names it internal.

const COMPILER_SOURCES = join(REPO_ROOT, "packages/core/compiler/src");
const STAGE_BY_DIRECTORY: readonly (readonly [string, string])[] = [
  ["load/", "load"],
  ["passes/tree/", "tree"],
  ["passes/access/", "access"],
  ["passes/derive/", "derive"],
];
const FULL_LITERAL = /"(seampact\/[a-z]+\/[a-z0-9-]+)"/g;
const RULE_LITERAL = /\brule:\s*"([a-z][a-z0-9-]*)"/g;
const UNION_TYPE = /type\s+\w*Rule\w*\s*=((?:\s*\|?\s*"[a-z][a-z0-9-]*")+)/g;
const UNION_MEMBER = /"([a-z][a-z0-9-]*)"/g;

function sourceFiles(directory: string, found: string[]): string[] {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);

    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.includes("test-support"))
      found.push(path);
  }

  return found;
}

const stageOf = (path: string): string | undefined =>
  STAGE_BY_DIRECTORY.find(([directory]) => path.startsWith(directory))?.[1];

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1] ?? "");
}

function shortIdsOf(text: string): string[] {
  const unions = matches(text, UNION_TYPE).flatMap((body) => matches(body, UNION_MEMBER));

  return [...matches(text, RULE_LITERAL), ...unions];
}

/** Every rule id the compiler can emit, sorted by UTF-16 code units. */
export function declaredRuleIds(): string[] {
  const ids = new Set<string>();

  for (const file of sourceFiles(COMPILER_SOURCES, [])) {
    const text = readFileSync(file, "utf8");
    const stage = stageOf(relative(COMPILER_SOURCES, file));

    for (const id of matches(text, FULL_LITERAL)) ids.add(id);

    if (stage !== undefined) for (const id of shortIdsOf(text)) ids.add(`seampact/${stage}/${id}`);
  }

  return [...ids].sort();
}
