import { describe, expect, test } from "vitest";
import { formatProblem, PROBLEM_FIELD_LIMIT, problemFromRefusal } from "./cli-problem.js";

const WHERE = "entry 'server', api 'tasks'";

describe("a target's refusal or warning as the CLI prints it", () => {
  test("names the operation and member once when the message already names them", () => {
    const problem = problemFromRefusal(
      {
        code: "owner.handler",
        message:
          "The caller ownership in operation 'getDraft' at /operations/2/access is not enforced by the generated boundary.",
        fix: "Scope the handler's reads and writes to the authenticated principal.",
        operation: "getDraft",
        member: "/operations/2/access",
      },
      WHERE,
    );

    expect(formatProblem(problem)).toBe(
      "owner.handler: entry 'server', api 'tasks': The caller ownership in operation 'getDraft' at /operations/2/access is not enforced by the generated boundary. Fix: Scope the handler's reads and writes to the authenticated principal.",
    );
  });

  test("adds a member that the message holds only as the start of a longer pointer", () => {
    const problem = problemFromRefusal(
      {
        code: "owner.handler",
        message: "The access at /operations/12/access is not enforced.",
        fix: "Scope the handler.",
        member: "/operations/1",
      },
      WHERE,
    );

    expect(problem.message).toBe(
      "The access at /operations/12/access is not enforced. (IR member '/operations/1')",
    );
  });

  test("adds the operation and member the message leaves out", () => {
    const problem = problemFromRefusal(
      {
        code: "owner.handler",
        message: "The caller ownership is not enforced by the generated boundary.",
        fix: "Scope the handler's reads and writes to the authenticated principal.",
        operation: "getDraft",
        member: "/operations/2/access",
      },
      WHERE,
    );

    expect(problem.message).toBe(
      "The caller ownership is not enforced by the generated boundary. (operation 'getDraft', IR member '/operations/2/access')",
    );
  });
});

describe("a problem as the CLI prints it", () => {
  test("holds no character a terminal acts on", () => {
    const printed = formatProblem({
      code: "x.\u001by",
      message: "a\u001b[2J\u202eb",
      fix: "f\u0007",
      where: "source '\u009b'",
      position: "api\u001b.yaml:1",
      docs: "https://x.test/\u200b",
    });

    expect(printed).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
    expect(printed).toContain("a\\u001B[2J\\u202Eb");
  });

  test("cuts a field past the bound with an ellipsis", () => {
    const printed = formatProblem({
      code: "x.y",
      message: "m".repeat(PROBLEM_FIELD_LIMIT + 50),
      fix: "f",
    });

    expect(printed.length).toBeLessThan(PROBLEM_FIELD_LIMIT + 50);
    expect(printed).toContain("\u2026 Fix: f");
  });
});
