import { type ContractIR, type FileTypeUse, isKnownVariant } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { changesOf, editedIr, goldenIr } from "../test-support.js";

// A file member's type use: the media it accepts and the largest size, compared at the operations reaching it.

const BODIES_IR = "bodies/notes.ir.json";

function uploadedFile(ir: ContractIR): FileTypeUse {
  for (const schema of Object.values(ir.schemas)) {
    if (!isKnownVariant("Schema", schema) || schema.kind !== "object") continue;

    for (const property of schema.properties) {
      const type = property.type;

      if (isKnownVariant("TypeUse", type) && type.kind === "file") return type;
    }
  }

  throw new Error("no file member in the test IR");
}

function sizeLimitOf(file: FileTypeUse): number {
  if (file.maxSizeBytes === undefined) throw new Error("the test upload has no size limit");

  return file.maxSizeBytes;
}

function fileChanges(edit: (file: FileTypeUse) => void) {
  const before = goldenIr(BODIES_IR);
  const after = editedIr((ir) => edit(uploadedFile(ir)), before);

  return changesOf(before, after);
}

function summary(changes: ReturnType<typeof fileChanges>) {
  return changes.map(({ kind, case: changeCase, position, breaks, pointer }) => ({
    kind,
    case: changeCase,
    position,
    breaks,
    member: pointer.split("/").at(-1),
  }));
}

test("an accepted media type removed from an upload breaks clients", () => {
  const changes = fileChanges((file) => {
    file.media = file.media.slice(1);
  });

  expect(summary(changes)).toEqual([
    {
      kind: "refinement",
      case: "tightened",
      position: "input",
      breaks: ["clients"],
      member: "media",
    },
  ]);
});

test("an accepted media type added to an upload breaks servers, which must now accept it", () => {
  const changes = fileChanges((file) => {
    file.media = [...file.media, "image/webp"];
  });

  expect(summary(changes)).toEqual([
    {
      kind: "refinement",
      case: "loosened",
      position: "input",
      breaks: ["servers"],
      member: "media",
    },
  ]);
});

test("a lower maximum size for an upload breaks clients", () => {
  const changes = fileChanges((file) => {
    file.maxSizeBytes = sizeLimitOf(file) / 2;
  });

  expect(summary(changes)).toEqual([
    {
      kind: "refinement",
      case: "tightened",
      position: "input",
      breaks: ["clients"],
      member: "maxSizeBytes",
    },
  ]);
});

test("a higher maximum size for an upload breaks servers", () => {
  const changes = fileChanges((file) => {
    file.maxSizeBytes = sizeLimitOf(file) * 2;
  });

  expect(summary(changes)).toEqual([
    {
      kind: "refinement",
      case: "loosened",
      position: "input",
      breaks: ["servers"],
      member: "maxSizeBytes",
    },
  ]);
});

test("an unchanged upload reports no change", () => {
  expect(fileChanges(() => undefined)).toEqual([]);
});
