import type { IrWriter } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { createDraftIR } from "./draft.js";
import { pipelineGuard } from "./guard.js";
import { PipelineReadonlyError, pipelineCopy, pipelineView } from "./view.js";

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

test("a view written into a guarded draft throws, at any depth; its pipelineCopy is stored", () => {
  const draft = createDraftIR();
  const pack: IrWriter.PackRef = pipelineView({ name: "house", version: "1.0.0" }, "raw");
  const guarded = pipelineGuard(draft, {
    half: "tree.nodes",
    reads: [],
    writes: ["packs", "operations[].examples"],
  });
  expect(() => guarded.draft.packs.push(pack)).toThrow(
    /tree\.nodes wrote packs\[0\]: a read-only view of raw is stored as is: copy it first: pipelineCopy\(value\)/,
  );
  expect(() =>
    guarded.draft.operations.push({ examples: { a: { value: { nested: [pack] } } } }),
  ).toThrow(/operations\[0\]: a read-only view of raw/);
  expect(draft.packs).toEqual([]);
  expect(draft.operations).toEqual([]);

  guarded.draft.packs.push(pipelineCopy(pack));
  guarded.dispose();
  const stored = draft.packs[0];
  expect(stored).toEqual({ name: "house", version: "1.0.0" });
  // A plain object: writable, and cloneable, which a proxy is not.
  if (stored !== undefined) stored.version = "2.0.0";
  expect(structuredClone(draft.packs)).toEqual([{ name: "house", version: "2.0.0" }]);
  expect(pack.version).toBe("1.0.0");
});

test("pipelineCopy copies views and plain values alike", () => {
  // A catalogue (no prototype) holding an entry named `__proto__`.
  const catalogue = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(catalogue, "__proto__", {
    value: { list: [1, { x: 2 }] },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  for (const value of [catalogue, pipelineView(catalogue, "relayed")]) {
    const copy = pipelineCopy(value);
    expect(copy).not.toBe(value);
    expect(Object.getPrototypeOf(copy)).toBe(null);
    expect(Object.keys(copy)).toEqual(["__proto__"]);
    expect(structuredClone(copy)).toEqual(structuredClone({ ...catalogue }));
    const inner = copy.__proto__ as { list: unknown[] };
    inner.list.push(3);
    expect((catalogue.__proto__ as { list: unknown[] }).list).toEqual([1, { x: 2 }]);
  }
  expect(pipelineCopy(7)).toBe(7);
  const thawed = pipelineCopy(Object.freeze({ a: Object.freeze([1]) }));
  thawed.a.push(2);
  expect(thawed.a).toEqual([1, 2]);
});

test("pipelineCopy refuses a value that is not JSON-shaped data", () => {
  class Holder {
    readonly value = 1;
  }
  for (const value of [new Map([["a", 1]]), new Date(0), new Holder(), { nested: [new Set([1])] }])
    expect(() => pipelineCopy(value)).toThrow(/pipelineCopy copies JSON-shaped data only/);
  expect(() => pipelineCopy({ nested: [new Holder()] })).toThrow(/at nested\.0: a Holder/);
});
