import { describe, expect, test } from "vitest";
import { ChangeSink } from "./sink.js";

describe("the change sink", () => {
  test("keeps apart the reaches of one change whose facts resolve to different outcomes", () => {
    const sink = new ChangeSink(new Set());

    sink.emit(
      { kind: "property.removed", case: "optional", pointer: "/schemas/Note/properties/1" },
      [
        { position: "input", operations: ["strictNote"], facts: ["afterRefusesUnknownKeys"] },
        { position: "input", operations: ["lenientNote"] },
        { position: "input", operations: ["otherStrictNote"], facts: ["afterRefusesUnknownKeys"] },
      ],
    );

    const outcomes = sink
      .sortedChanges()
      .map((change) => ({ operations: change.operations, breaks: change.breaks }));

    expect(outcomes).toEqual([
      { operations: ["lenientNote"], breaks: [] },
      { operations: ["otherStrictNote", "strictNote"], breaks: ["clients"] },
    ]);
  });
});
