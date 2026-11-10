import { describe, expect, test } from "vitest";
import {
  inputRuleHookName,
  parseSampleAppScript,
  SampleAppScriptError,
} from "./sample-app-script.js";
import { parseSuiteCase, SuiteCaseError } from "./suite-case.js";

describe("parseSampleAppScript", () => {
  test("reads decisions, scope denials and answers, and copies their JSON values", () => {
    const body = { taskId: "t1", effort: 5 };
    const script = parseSampleAppScript({
      decisions: [{ name: "tasks.seeEffort", purpose: "field", deny: { code: "api.forbidden" } }],
      scopes: { channel: { deny: { code: "api.not_found" } } },
      answers: {
        "tasks.getTask": { status: 200, body },
        "tasks.health": { throws: "down" },
        "tasks.getChannel": { status: 404, code: "api.not_found", params: {} },
      },
      hookFailures: { "resolve-scope:channel": "the membership store is down" },
    });

    body.effort = 0;

    expect(script).toEqual({
      decisions: [{ name: "tasks.seeEffort", purpose: "field", deny: { code: "api.forbidden" } }],
      scopes: { channel: { deny: { code: "api.not_found" } } },
      answers: {
        "tasks.getTask": { status: 200, body: { taskId: "t1", effort: 5 } },
        "tasks.health": { throws: "down" },
        "tasks.getChannel": { status: 404, code: "api.not_found", params: {} },
      },
      hookFailures: { "resolve-scope:channel": "the membership store is down" },
    });
    expect(parseSampleAppScript({})).toEqual({});
  });

  test("lets an app input rule's double throw, under the name the rule's hook name gives", () => {
    const failures = { [inputRuleHookName("endAfterStart")]: "the rule store is down" };

    expect(parseSampleAppScript({ hookFailures: failures })).toEqual({ hookFailures: failures });
  });

  test.each([
    ["an unknown member", { hooks: {} }, "at '/hooks': unknown member"],
    [
      "an unknown purpose",
      { decisions: [{ name: "roles", purpose: "query", deny: { code: "api.forbidden" } }] },
      "at '/decisions/0/purpose'",
    ],
    [
      "a denial without a code",
      { scopes: { channel: { deny: {} } } },
      "at '/scopes/channel/deny/code'",
    ],
    [
      "an answer key without its api",
      { answers: { getTask: { status: 200 } } },
      "at '/answers/getTask'",
    ],
    [
      "a throwing answer with a status",
      { answers: { "tasks.health": { throws: "down", status: 500 } } },
      "at '/answers/tasks.health/status': unknown member",
    ],
    [
      "a hook failure of a hook no double has",
      { hookFailures: { "relay:tasks": "down" } },
      "at '/hookFailures/relay:tasks'",
    ],
    [
      "a hook failure without its message",
      { hookFailures: { "authenticate:user": true } },
      "at '/hookFailures/authenticate:user'",
    ],
    [
      "a status out of range",
      { answers: { "tasks.health": { status: 42 } } },
      "at '/answers/tasks.health/status'",
    ],
  ])("refuses %s by its pointer", (_case, value, message) => {
    expect(() => parseSampleAppScript(value)).toThrow(SampleAppScriptError);
    expect(() => parseSampleAppScript(value)).toThrow(message);
  });

  test("a case names the pointer of a fault in its script", () => {
    const value = {
      id: "scripted",
      title: "Scripted",
      checks: [],
      profiles: ["default"],
      script: { answers: { "tasks.health": { status: "200" } } },
      steps: [{ request: { method: "GET", path: "/" }, expect: { status: 200 } }],
    };

    expect(() => parseSuiteCase(value, "case.json")).toThrow(SuiteCaseError);
    expect(() => parseSuiteCase(value, "case.json")).toThrow(
      "at '/script/answers/tasks.health/status'",
    );
  });
});
