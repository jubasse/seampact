import { basename, dirname, join } from "node:path";
import {
  commitGeneratedWrite,
  type PlannedWrite,
  type PlanWriteOptions,
  planGeneratedWrite,
  type Refusal,
  readManifest,
} from "@seampact/codegen-core";
import type { CheckLevel } from "@seampact/spec/config";
import { type CliIo, printWarnings } from "../cli-io.js";
import { appEntryWhere, type CliProblem, problemFromRefusal } from "../cli-problem.js";
import type { EmittedDocument } from "./document-emission.js";
import { strictestLevel } from "./drift-level.js";
import type { GeneratedOutput } from "./entry-generation.js";
import type { Step } from "./step.js";

// The writer's owner of a document directory's manifest.
export const DOCUMENT_OWNER = "openapi";

// A write after the writer's checks: planned, or refused with the writer's refusals.
export type WriteCheck =
  | { status: "planned"; write: PlannedWrite }
  | { status: "refused"; refusals: readonly Refusal[] };

export interface EntryWrite {
  output: GeneratedOutput;
  check: WriteCheck;
}

// The documents of one directory, written by one writer call under the `openapi` owner; `level` is the strictest
// `checks.openapi` of the documents planned there.
export interface DocumentDirectoryWrite {
  directory: string;
  documents: EmittedDocument[];
  check: WriteCheck;
  level: CheckLevel;
}

// Every write of the run, each checked, nothing written yet.
export interface PlannedWrites {
  entries: EntryWrite[];
  documents: DocumentDirectoryWrite[];
}

// A default document directory an app's config plans no document in: documents seampact wrote there are removed.
export interface SweptDirectory {
  directory: string;
  level: CheckLevel;
}

// Every write checked before the first one: each entry's output directory, then each document directory, and each
// swept directory that holds documents seampact wrote.
export async function planWrites(
  outputs: readonly GeneratedOutput[],
  documents: readonly EmittedDocument[],
  swept: readonly SweptDirectory[],
  options: PlanWriteOptions,
): Promise<PlannedWrites> {
  const entries: EntryWrite[] = [];
  const documentWrites: DocumentDirectoryWrite[] = [];

  for (const output of outputs) {
    entries.push({
      output,
      check: await checkWrite(output.root, output.entryId, output.files, options),
    });
  }

  for (const [directory, group] of await documentDirectories(documents, swept)) {
    documentWrites.push({
      directory,
      documents: group.documents,
      level: group.level,
      check: await checkWrite(
        directory,
        DOCUMENT_OWNER,
        group.documents.map((document) => ({
          path: basename(document.file),
          contents: document.text,
        })),
        options,
      ),
    });
  }

  return { entries, documents: documentWrites };
}

async function checkWrite(
  directory: string,
  owner: string,
  files: Parameters<typeof planGeneratedWrite>[2],
  options: PlanWriteOptions,
): Promise<WriteCheck> {
  const planned = await planGeneratedWrite(directory, owner, files, options);

  return planned.status === "refused"
    ? { status: "refused", refusals: planned.refusals }
    : { status: "planned", write: planned.write };
}

interface DocumentGroup {
  documents: EmittedDocument[];
  level: CheckLevel;
}

// The documents by directory, with a swept directory's previous documents removed when none is planned there.
async function documentDirectories(
  documents: readonly EmittedDocument[],
  swept: readonly SweptDirectory[],
): Promise<Map<string, DocumentGroup>> {
  const byDirectory = new Map<string, EmittedDocument[]>();

  for (const document of documents) {
    const directory = dirname(document.file);

    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), document]);
  }

  const groups = new Map<string, DocumentGroup>(
    [...byDirectory].map(([directory, group]) => [
      directory,
      { documents: group, level: strictestLevel(group.map((document) => document.level)) },
    ]),
  );

  for (const { directory, level } of swept) {
    if (!groups.has(directory) && (await holdsWrittenDocuments(directory)))
      groups.set(directory, { documents: [], level });
  }

  return groups;
}

async function holdsWrittenDocuments(directory: string): Promise<boolean> {
  const manifest = await readManifest(directory);

  return manifest.status === "read" && manifest.owner === DOCUMENT_OWNER;
}

// A writer refusal in a document directory, with the fixes an app has for its documents.
export function documentProblem(directory: string): (refusal: Refusal) => CliProblem {
  const where = `openapi documents in ${directory}`;

  return (refusal) => {
    if (refusal.code === "writer.file.not-generated") {
      return {
        code: "openapi.document.not-generated",
        message: refusal.message,
        fix: "Move or rename that file, write `openapi: none` in the app config to write no seampact document, or give the document another path in `openapi`.",
        where,
      };
    }

    if (refusal.code === "writer.file.edited") {
      return {
        code: "openapi.document.edited",
        message: refusal.message,
        fix: "Delete the edited document so that `generate` writes it again, run `seampact generate --force` to write it over the edit, or give the document another path in `openapi`.",
        where,
      };
    }

    return problemFromRefusal(refusal, where);
  };
}

export function entryWriteProblems(write: EntryWrite): CliProblem[] {
  if (write.check.status === "planned") return [];

  const where = appEntryWhere(write.output.app, write.output.entryId, write.output.api);

  return write.check.refusals.map((refusal) => problemFromRefusal(refusal, where));
}

export function documentWriteProblems(write: DocumentDirectoryWrite): CliProblem[] {
  return write.check.status === "planned"
    ? []
    : write.check.refusals.map(documentProblem(write.directory));
}

// The writes as planned writes, or every refusal of the run.
export interface CommittableWrites {
  entries: { output: GeneratedOutput; write: PlannedWrite }[];
  documents: { directory: string; documents: EmittedDocument[]; write: PlannedWrite }[];
}

export function committableWrites(writes: PlannedWrites): Step<CommittableWrites> {
  const problems = [
    ...writes.entries.flatMap(entryWriteProblems),
    ...writes.documents.flatMap(documentWriteProblems),
  ];

  if (problems.length > 0) return { status: "refused", problems };

  return {
    status: "done",
    value: {
      entries: writes.entries.flatMap(({ output, check }) =>
        check.status === "planned" ? [{ output, write: check.write }] : [],
      ),
      documents: writes.documents.flatMap(({ directory, documents, check }) =>
        check.status === "planned" ? [{ directory, documents, write: check.write }] : [],
      ),
    },
  };
}

// Writes entry by entry, then each document directory, every write already checked; prints each entry's warnings.
export async function commitWrites(writes: CommittableWrites, io: CliIo): Promise<void> {
  for (const { output, write } of writes.entries) {
    const written = await commitGeneratedWrite(write);
    const where = appEntryWhere(output.app, output.entryId, output.api);

    io.stdout(
      `${where}: ${written.written.length} written, ${written.unchanged.length} unchanged, ${written.removed.length} removed (${output.root}).\n`,
    );
    printWarnings(
      io,
      output.warnings.map((warning) => problemFromRefusal(warning, where)),
    );
  }

  for (const { directory, documents, write } of writes.documents) {
    const written = await commitGeneratedWrite(write);

    for (const document of documents) {
      const state = written.written.includes(basename(document.file)) ? "written" : "unchanged";

      io.stdout(`openapi document '${document.name}': ${state} (${document.file}).\n`);
    }

    for (const removed of written.removed)
      io.stdout(`openapi document ${join(directory, removed)}: removed.\n`);
  }
}
