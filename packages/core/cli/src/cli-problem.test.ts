import { describe, expect, test } from "vitest";
import { formatProblem, problemFromRefusal } from "./cli-problem.js";

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
      "The access at /operations/12/access is not enforced. (member '/operations/1')",
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
      "The caller ownership is not enforced by the generated boundary. (operation 'getDraft', member '/operations/2/access')",
    );
  });
});
