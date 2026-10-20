import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type ContractIR,
  isKnownVariant,
  type MemberName,
  type PagingStyle,
  type Template,
  type WireFormat,
} from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { SCRIPT_ROUTE } from "./control-routes.js";
import { FormatReaderError, formatReaderOf } from "./format-reader.js";
import { packProfileOf } from "./pack-profile.js";
import { isJsonObject } from "./response-check.js";
import type { JsonValue } from "./suite-case.js";
import { parseSuiteCase } from "./suite-case.js";
import { runSuite, type SuiteCredentials } from "./suite-runner.js";

// A round trip per first-party pack: the golden IR's template applied to a payload, then read back.

const GOLDEN_DIRECTORY = new URL("../../../../fixtures/golden/", import.meta.url);
const PACKS = ["hal", "api-platform", "laravel", "spring"];
const TASKS = [
  { taskId: "t1", title: "first" },
  { taskId: "t2", title: "second" },
];
const ITEM = { taskId: "t1", title: "first", state: "open" };
const ERROR_CODE = "api.schema_invalid";
const ERROR_PARAMS = { issues: [{ pointer: "/title", rule: "minLength" }] };
const CREDENTIALS: SuiteCredentials = {
  userToken: "u",
  throttledUserToken: "t",
  serviceJwt: "s",
  stripeSecret: "w",
  throttleRetryAfterMs: 1000,
  foreignServiceJwt: "f",
};

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("the golden IR lacks an expected entry");

  return value;
}

function goldenIr(packName: string): ContractIR {
  const text = readFileSync(new URL(`pack-${packName}/tasks.ir.json`, GOLDEN_DIRECTORY), "utf8");

  return JSON.parse(text);
}

// Test double of what a target writes: the template applied to the values of its slots.
function render(template: Template, slots: ReadonlyMap<string, JsonValue>): JsonValue | undefined {
  if (!isKnownVariant("Template", template)) throw new Error(`unknown template ${template.kind}`);

  switch (template.kind) {
    case "slot":
      return slots.get(template.slot);
    case "text":
      return template.parts
        .map((part) => {
          if (!isKnownVariant("TextPart", part)) throw new Error(`unknown part ${part.kind}`);

          return part.kind === "text" ? part.text : String(slots.get(part.slot));
        })
        .join("");
    case "literal":
      return JSON.parse(JSON.stringify(template.value));
    case "array":
      return template.items.map((item) => render(item, slots) ?? null);
    case "each":
      return eachElements(slots.get(template.of)).map(
        (element) =>
          render(
            template.as,
            new Map([...slots, ["item", element], ["itemSelf", `/v1/tasks/${taskIdOf(element)}`]]),
          ) ?? null,
      );
    case "object":
      return renderObject(template, slots);
  }
}

function eachElements(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? [...value] : [];
}

function memberNameOf(name: MemberName, slots: ReadonlyMap<string, JsonValue>): string {
  if (!isKnownVariant("MemberName", name)) throw new Error(`unknown member name ${name.kind}`);

  return name.kind === "text" ? name.text : String(slots.get(name.slot));
}

function taskIdOf(element: JsonValue): JsonValue {
  return isJsonObject(element) ? (element.taskId ?? null) : null;
}

function renderObject(
  template: Extract<Template, { kind: "object" }>,
  slots: ReadonlyMap<string, JsonValue>,
): JsonValue | undefined {
  const written: Record<string, JsonValue> = {};

  for (const member of template.members) {
    const name = memberNameOf(member.name, slots);
    const value = render(member.value, slots);

    if (value !== undefined) written[name] = value;
  }

  const merged = template.merge === undefined ? undefined : slots.get(template.merge);

  if (Object.keys(written).length === 0 && merged === undefined) return undefined;

  return { ...(merged !== undefined && isJsonObject(merged) ? merged : {}), ...written };
}

const URL_SLOTS = ["self", "first", "previous", "next", "last"].map((role): [string, JsonValue] => [
  role,
  `/v1/tasks?${role}=1`,
]);

function slotsOf(extra: Record<string, JsonValue>): Map<string, JsonValue> {
  return new Map<string, JsonValue>([
    ...URL_SLOTS,
    ["resource", "Task"],
    ["collection", "tasks"],
    ["path", "/v1/tasks"],
    ["total", 2],
    ["page", 0],
    ["limit", 10],
    ["totalPages", 1],
    ["status", 422],
    ["title", "Invalid"],
    ["nature", "refused"],
    ...Object.entries(extra),
  ]);
}

describe.each(PACKS)("pack %s", (packName) => {
  const ir = goldenIr(packName);
  const packageName = `@seampact/pack-${packName}`;
  const profile = packProfileOf(ir, packageName);
  const format = required(
    Object.values(ir.formats).find(
      (candidate) => candidate.origin.layer === `pack:${packageName}`,
    ) ?? ir.formats.bare,
  );
  const paging: PagingStyle | undefined = Object.values(ir.pagings)[0];

  test("reads an item back to its payload", () => {
    const body = render(format.success.item.body, slotsOf({ payload: ITEM }));

    expect(profile.reader.read(200, body ?? null).json).toEqual(ITEM);
  });

  test("reads a page back to its items", () => {
    const template = paging?.response.body ?? format.success.page.body;
    const body = render(template, slotsOf({ items: TASKS }));

    expect(profile.reader.read(200, body ?? null)).toEqual({ json: TASKS, failures: [] });
  });

  test("reads an error back to its code and params", () => {
    const body = render(format.error.body, slotsOf({ code: ERROR_CODE, params: ERROR_PARAMS }));

    expect(profile.reader.read(422, body ?? null).json).toMatchObject({
      code: ERROR_CODE,
      ...ERROR_PARAMS,
    });
  });
});

describe("a template the suite cannot invert", () => {
  const code: Template = {
    kind: "text",
    parts: [
      { kind: "text", text: "https://e/" },
      { kind: "slot", slot: "code", path: [] },
    ],
  };
  const format = (body: Template): WireFormat => ({
    ...required(goldenIr("hal").formats.hal),
    id: "acme",
    error: { media: "application/problem+json", body, headers: [] },
  });

  test("refuses a code only inside a text template, naming the format and the member", () => {
    const body: Template = {
      kind: "object",
      members: [{ name: { kind: "text", text: "type" }, value: code }],
    };

    expect(() => formatReaderOf(format(body), undefined)).toThrow(FormatReaderError);
    expect(() => formatReaderOf(format(body), undefined)).toThrow(
      "format 'acme', error: the member 'type' writes the code only inside a text template",
    );
  });
});

describe("the pack profile", () => {
  test("adapts the default cases to the pack's request names and error media", () => {
    const profile = packProfileOf(goldenIr("hal"), "@seampact/pack-hal");
    const limitCase = profile.cases.find((suiteCase) => suiteCase.id === "limit-above-max-refused");

    expect(profile.profile).toBe("pack:hal");
    expect(limitCase?.steps[0]?.request.query).toHaveProperty("size");
    expect(Object.keys(profile.refusals)).toContain("page-links-next-page");
    expect(profile.cases.map((suiteCase) => suiteCase.id)).toContain("pack-hal-page-next-link");
  });

  test("reads a default case through the pack's format", async () => {
    const profile = packProfileOf(goldenIr("hal"), "@seampact/pack-hal");
    const server: Server = createServer((request, response) => {
      if (request.url === SCRIPT_ROUTE) {
        response.writeHead(204).end();
      } else if (request.url === "/item") {
        response.writeHead(200, { "content-type": "application/hal+json" });
        response.end(JSON.stringify({ ...ITEM, _links: { self: { href: "/item" } } }));
      } else {
        response.writeHead(404, { "content-type": "application/problem+json" });
        response.end(JSON.stringify({ type: "api.not_found", status: 404, code: "api.not_found" }));
      }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address: AddressInfo | string | null = server.address();

    if (address === null || typeof address === "string") throw new Error("no TCP port");

    const steps = [
      { request: { method: "GET", path: "/item" }, expect: { status: 200, body: ITEM } },
      {
        request: { method: "GET", path: "/gone" },
        expect: { status: 404, body: { code: "api.not_found" } },
      },
    ];
    const report = await runSuite({
      baseUrl: `http://127.0.0.1:${address.port}`,
      target: "double",
      profile: profile.profile,
      credentials: CREDENTIALS,
      cases: [
        parseSuiteCase(
          { id: "read", title: "read", checks: [], profiles: ["default"], steps },
          "read",
        ),
      ],
      reader: profile.reader,
    });

    server.close();

    expect(report.cases[0]).toMatchObject({ outcome: "passed", failures: [] });
  });
});
