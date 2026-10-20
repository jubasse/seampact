import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlannedWrite, Refusal } from "@seampact/codegen-core";
import { findDocumentDrift } from "@seampact/openapi";
import { appEntryWhere, type CliProblem } from "../cli-problem.js";
import { errorCode } from "../error-code.js";
import type { PlannedWrites, WriteCheck } from "./write-plan.js";

// What `check` finds when the files a run would write differ from the committed ones (ADR 0015 "Writing files",
// ADR 0011 `checks`): drift at `error` fails, at `warning` is reported, `disabled` is not looked for.
export interface WriteDrift {
  // A drift of a check at `error`, or a refusal that is not a drift.
  errors: CliProblem[];
  warnings: CliProblem[];
}

const HAND_EDIT_CODES: ReadonlySet<string> = new Set([
  "writer.file.edited",
  "writer.file.not-generated",
]);

export async function findWriteDrift(writes: PlannedWrites): Promise<WriteDrift> {
  const drift: WriteDrift = { errors: [], warnings: [] };

  for (const { output, check } of writes.entries) {
    const where = appEntryWhere(output.app, output.entryId, output.api);

    await addDrift(drift, check, {
      level: output.level,
      code: "check.generated.drift",
      subject: `The generated files of ${where}`,
      fix: "Run `seampact generate` and commit the result, or set `checks.generated` to `warning` or `disabled` in the app config.",
      where,
    });
  }

  for (const { directory, check, level } of writes.documents) {
    await addDrift(drift, check, {
      level,
      code: "check.openapi.drift",
      subject: `The seampact OpenAPI documents in ${directory}`,
      fix: "Run `seampact generate` and commit the result, or set `checks.openapi` to `warning` or `disabled` in the config that writes them.",
      where: `openapi documents in ${directory}`,
    });
  }

  return drift;
}

interface DriftKind {
  level: "error" | "warning" | "disabled";
  code: string;
  subject: string;
  fix: string;
  where: string;
}

async function addDrift(drift: WriteDrift, check: WriteCheck, kind: DriftKind): Promise<void> {
  const items = await driftItems(check);

  if (items.status === "unreadable") {
    drift.errors.push(...items.refusals.map((refusal) => refusalProblem(refusal, kind.where)));

    return;
  }

  // A disabled level looks for no drift, but a directory `generate` refuses is refused here too.
  if (kind.level === "disabled" || items.items.length === 0) return;

  const problem: CliProblem = {
    code: kind.code,
    message: `${kind.subject} differ from the committed files: ${items.items.join("; ")}.`,
    fix: kind.fix,
    where: kind.where,
  };

  if (kind.level === "error") drift.errors.push(problem);
  else drift.warnings.push(problem);
}

type DriftItems =
  | { status: "listed"; items: string[] }
  | { status: "unreadable"; refusals: readonly Refusal[] };

// A hand-edited file is drift, named by the writer's message; any other refusal says the check cannot compare.
async function driftItems(check: WriteCheck): Promise<DriftItems> {
  if (check.status === "planned")
    return { status: "listed", items: await plannedDrift(check.write) };

  const other = check.refusals.filter((refusal) => !HAND_EDIT_CODES.has(refusal.code));

  if (other.length > 0) return { status: "unreadable", refusals: other };

  return { status: "listed", items: check.refusals.map((refusal) => refusal.message) };
}

function refusalProblem(refusal: Refusal, where: string): CliProblem {
  return { code: refusal.code, message: refusal.message, fix: refusal.fix, where };
}

async function plannedDrift(write: PlannedWrite): Promise<string[]> {
  const unchanged = new Set(write.unchanged);
  const items: string[] = [];

  for (const file of write.files) {
    if (unchanged.has(file.path)) continue;

    items.push(
      await fileDrift(join(write.rootDir, file.path), file.path, file.bytes.toString("utf8")),
    );
  }

  for (const path of write.removable) {
    items.push(`${path} (stale: generated earlier, no longer produced)`);
  }

  return items;
}

async function fileDrift(location: string, path: string, generated: string): Promise<string> {
  const committed = await readCommitted(location);

  if (committed === undefined) return `${path} (missing)`;

  const drift = findDocumentDrift(committed, generated);

  return drift === undefined ? `${path} (differs)` : `${path} (differs at line ${drift.line})`;
}

async function readCommitted(location: string): Promise<string | undefined> {
  try {
    return await readFile(location, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;

    throw error;
  }
}
