import {
  BOUNDARY_STEPS,
  type BoundaryStep,
  GLUE_ROW,
  IDEMPOTENCY_ROW,
  NEUTRAL_FUNCTIONS,
  OTHER_ROWS,
} from "./boundary-steps.ts";

// The part of a V8 `.cpuprofile` the folding reads.
export interface CpuProfile {
  readonly nodes: readonly CpuProfileNode[];
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
}

export interface CpuProfileNode {
  readonly id: number;
  readonly callFrame: { readonly functionName: string; readonly url: string };
  readonly children?: readonly number[];
}

export interface FoldedRow {
  readonly id: string;
  readonly title: string;
  readonly microseconds: number;
  // Share of the busy time (idle excluded).
  readonly share: number;
  readonly microsecondsPerRequest: number;
}

const GENERATED_RUNTIME = "/generated/server/";
const RUNTIME_DIRECTORY = "/node-server/";
const GENERATED_VALIDATORS = "/generated/validators/";
const NODE_MODULES = "/node_modules/";
const VALIDATOR_PACKAGES = [
  "/node_modules/zod/",
  "/node_modules/yup/",
  "/node_modules/class-validator/",
  "/node_modules/class-transformer/",
  "/node_modules/@standard-schema/",
];
// The seampact runtime libraries the boundary calls (signature check, idempotency store): their caller's step takes the time.
const NEUTRAL_PACKAGES = ["/node_modules/@seampact/"];
const TEMPLATE_HOOKS = "/src/hooks.";
const TEMPLATE_HANDLERS = "/src/handlers.";
const IDLE = "(idle)";
const ROOT = "(root)";
const STEP_ROWS: readonly BoundaryStep[] = [...BOUNDARY_STEPS, IDEMPOTENCY_ROW, GLUE_ROW];

type Claim = { readonly row: string } | "neutral" | "idle";

// Which row claims one frame: a named step, an other row, or neutral when its caller should take the time.
function claimOf(functionName: string, url: string): Claim {
  if (functionName === IDLE) return "idle";

  if (functionName === ROOT || functionName.startsWith("(")) return { row: "internals" };

  if (url === "" || url.startsWith("node:")) return "neutral";

  if (url.includes(TEMPLATE_HANDLERS)) return { row: "handler" };

  if (url.includes(TEMPLATE_HOOKS)) return "neutral";

  if (url.includes(NODE_MODULES)) return claimOfPackage(url);

  if (url.includes(GENERATED_VALIDATORS)) return { row: "validators" };

  if (url.includes(GENERATED_RUNTIME)) return claimOfGenerated(functionName, url);

  return { row: "other" };
}

function claimOfPackage(url: string): Claim {
  if (VALIDATOR_PACKAGES.some((name) => url.includes(name))) return { row: "validators" };

  if (NEUTRAL_PACKAGES.some((name) => url.includes(name))) return "neutral";

  return { row: "framework" };
}

function claimOfGenerated(functionName: string, url: string): Claim {
  if (NEUTRAL_FUNCTIONS.includes(functionName)) return "neutral";

  const byName = STEP_ROWS.find((step) => step.functions.includes(functionName));

  if (byName !== undefined) return { row: byName.id };

  if (!url.includes(RUNTIME_DIRECTORY)) return { row: GLUE_ROW.id };

  const baseName = url.slice(url.lastIndexOf("/") + 1).replace(/\.[a-z]+$/, "");
  const byFile = STEP_ROWS.find((step) => step.files.includes(baseName));

  return { row: byFile === undefined ? GLUE_ROW.id : byFile.id };
}

// Walks one sample's stack from the leaf up and answers the first row that claims a frame; a stack of neutral
// frames only is Node internals.
function rowOfStack(
  leafId: number,
  parents: ReadonlyMap<number, number>,
  nodes: ReadonlyMap<number, CpuProfileNode>,
): string | "idle" {
  let current: number | undefined = leafId;

  while (current !== undefined) {
    const node = nodes.get(current);

    if (node !== undefined) {
      const claim = claimOf(node.callFrame.functionName, node.callFrame.url);

      if (claim === "idle") return "idle";

      if (claim !== "neutral") return claim.row;
    }

    current = parents.get(current);
  }

  return "internals";
}

/**
 * Folds a profile into the rows of the check order: microseconds and share of the busy time per row, and per
 * request served. Every row of the map is present, with zero where nothing ran.
 */
export function foldProfile(profile: CpuProfile, requests: number): readonly FoldedRow[] {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map(
    profile.nodes.flatMap((node) =>
      (node.children ?? []).map((child) => [child, node.id] as const),
    ),
  );
  const microsecondsByRow = new Map<string, number>();

  profile.samples.forEach((leafId, index) => {
    const row = rowOfStack(leafId, parents, nodes);

    if (row === "idle") return;

    // `timeDeltas` are microseconds; the delta before a sample is the time it stands for.
    const microseconds = profile.timeDeltas[index] ?? 0;

    microsecondsByRow.set(row, (microsecondsByRow.get(row) ?? 0) + microseconds);
  });

  const busy = [...microsecondsByRow.values()].reduce((sum, value) => sum + value, 0);
  const rows = [
    ...STEP_ROWS.map(({ id, title }) => ({ id, title })),
    ...Object.entries(OTHER_ROWS).map(([id, title]) => ({ id, title })),
  ];

  return rows.map(({ id, title }) => {
    const microseconds = microsecondsByRow.get(id) ?? 0;

    return {
      id,
      title,
      microseconds,
      share: busy === 0 ? 0 : microseconds / busy,
      microsecondsPerRequest: requests === 0 ? 0 : microseconds / requests,
    };
  });
}

// The rows with time, largest first: the top of a profile.
export function topRows(rows: readonly FoldedRow[], count: number): readonly FoldedRow[] {
  return [...rows]
    .filter((row) => row.microseconds > 0)
    .sort((left, right) => right.microseconds - left.microseconds)
    .slice(0, count);
}
