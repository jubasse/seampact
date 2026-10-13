import { expect, test } from "vitest";
import * as derivations from "../derivations/index.js";
import * as pipeline from "./index.js";

// One naming rule keeps the shared compiler barrel free of TS2308 (INDEX rules): every value the seam exports
// names a seam concept as a word, `Pipeline`, `Draft` or `Derivation` (any case), which no stage lane's names
// carry; the one exception is the pipeline's entry, `compileWorkspace`.
const SEAM_WORD = /pipeline|draft|derivation/i;

test("every value the seam exports carries a seam word", () => {
  const names = [...Object.keys(pipeline), ...Object.keys(derivations)];
  expect(names.length).toBeGreaterThan(0);
  for (const name of names)
    expect(name === "compileWorkspace" || SEAM_WORD.test(name), name).toBe(true);
});
