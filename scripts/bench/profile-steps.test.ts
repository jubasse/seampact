import { describe, expect, test } from "vitest";
import { type CpuProfile, foldProfile, topRows } from "./profile-steps.ts";

const RUNTIME = "file:///project/generated/server/tasks/node-server";

function frame(id: number, functionName: string, url: string, children: number[] = []) {
  return { id, callFrame: { functionName, url }, children };
}

// root -> authenticate -> hook (neutral, template) ; root -> validateRequest -> zod parse ; root -> handler ;
// root -> idle.
const profile: CpuProfile = {
  nodes: [
    frame(1, "(root)", "", [2, 4, 6, 7]),
    frame(2, "authenticate", `${RUNTIME}/access-checks.ts`, [3]),
    frame(3, "authenticate", "file:///project/src/hooks.mts"),
    frame(4, "validateRequest", `${RUNTIME}/input-issues.ts`, [5]),
    frame(5, "parse", "file:///project/node_modules/.pnpm/zod@4.6.7/node_modules/zod/index.js"),
    frame(6, "getChannel", "file:///project/src/handlers.mts"),
    frame(7, "(idle)", ""),
  ],
  samples: [3, 3, 5, 2, 6, 7, 7, 7],
  timeDeltas: [10, 10, 30, 10, 20, 100, 100, 100],
};

describe("foldProfile", () => {
  const rows = foldProfile(profile, 2);
  const byId = (id: string) => rows.find((row) => row.id === id);

  test("gives a neutral hook frame's time to the step that called it", () => {
    expect(byId("step 2")?.microseconds).toBe(30);
  });

  test("keeps the validator library apart from the step that called it", () => {
    expect(byId("validators")?.microseconds).toBe(30);
    expect(byId("step 6")?.microseconds).toBe(0);
  });

  test("maps the target's own validators and Ajv to the validators row", () => {
    const own: CpuProfile = {
      nodes: [
        frame(1, "(root)", "", [2, 4]),
        frame(
          2,
          "validate",
          "file:///project/generated/server/tasks/validators/ajv-support.ts",
          [3],
        ),
        frame(
          3,
          "validate",
          "file:///project/node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/x.js",
        ),
        frame(4, "handler", "file:///project/src/handlers.mts"),
      ],
      samples: [2, 3, 4],
      timeDeltas: [10, 20, 5],
    };

    expect(foldProfile(own, 1).find((row) => row.id === "validators")?.microseconds).toBe(30);
  });

  test("counts the handler and leaves idle time out of the shares", () => {
    expect(byId("handler")?.microseconds).toBe(20);
    expect(byId("step 2")?.share).toBeCloseTo(30 / 80);
  });

  test("divides by the requests served", () => {
    expect(byId("step 2")?.microsecondsPerRequest).toBe(15);
  });

  test("names the steps the generator has no code for with zero time", () => {
    expect(byId("step 3")).toMatchObject({ microseconds: 0 });
    expect(byId("step 8")).toMatchObject({ microseconds: 0 });
  });

  test("ranks the rows with time", () => {
    expect(topRows(rows, 2).map((row) => row.id)).toEqual(["step 2", "validators"]);
  });
});
