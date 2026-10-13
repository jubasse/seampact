import type { IrWriter } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { createDraftIR } from "./draft.js";
import { pipelineGuard } from "./guard.js";
import { PipelineReadonlyError, pipelineView } from "./view.js";

test("a view refuses every change and reads as its target", () => {
  const target = { name: "p", list: [{ x: 1 }], frozen: Object.freeze({ y: { z: 2 } }) };
  const view = pipelineView(target, "raw");
  expect(view).toEqual(target);
  expect(view.list).toBe(view.list);
  // A member of a frozen object reads as itself (a proxy invariant).
  expect(view.frozen.y).toBe(target.frozen.y);
  const refusals: (() => unknown)[] = [
    () => Reflect.set(view, "name", "q"),
    () => Reflect.set(view.list, "length", 0),
    () => view.list.push({ x: 2 }),
    () => Reflect.defineProperty(view, "added", { value: 1 }),
    () => Reflect.deleteProperty(view.list[0] ?? {}, "x"),
    () => Reflect.setPrototypeOf(view, null),
    () => Object.preventExtensions(view),
  ];
  for (const refusal of refusals) expect(refusal).toThrow(PipelineReadonlyError);
  expect(() => Reflect.set(view.list, "0", {})).toThrow(/raw\.list\.0 is read-only/);
  expect(target).toEqual({ name: "p", list: [{ x: 1 }], frozen: { y: { z: 2 } } });
});

test("a view written into a guarded draft is stored as a plain copy", () => {
  const draft = createDraftIR();
  const pack: IrWriter.PackRef = pipelineView({ name: "house", version: "1.0.0" }, "raw");
  const guarded = pipelineGuard(draft, { half: "tree.nodes", reads: [], writes: ["packs"] });
  guarded.draft.packs.push(pack);
  guarded.dispose();
  const stored = draft.packs[0];
  expect(stored).toEqual({ name: "house", version: "1.0.0" });
  // A plain object: writable, and cloneable, which a proxy is not.
  if (stored !== undefined) stored.version = "2.0.0";
  expect(structuredClone(draft.packs)).toEqual([{ name: "house", version: "2.0.0" }]);
  expect(pack.version).toBe("1.0.0");
});
