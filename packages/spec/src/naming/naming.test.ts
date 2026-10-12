import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import {
  canonicalId,
  deriveName,
  identifier,
  isReserved,
  isTypeRole,
  LANGUAGES,
  type Language,
  type Name,
  operationId,
  ROLES,
  type Role,
  segmentsOf,
  splitName,
  suffixWords,
} from "./index.js";
import reservedWords from "../../vectors/naming/reserved-words.json" with { type: "json" };
import vectors from "../../vectors/naming/vectors.json" with { type: "json" };
import reservedSchema from "../../vectors/naming/reserved-words.schema.json" with { type: "json" };
import schema from "../../vectors/naming/vectors.schema.json" with { type: "json" };

interface Vector {
  id: string;
  category: string;
  role: Role;
  source?: "name" | "enumValue" | "right";
  written?: string;
  codeName?: string;
  position?: number;
  owner?: string[];
  status?: number;
  segments?: string[];
  error?: string;
  expected?: Record<Language, string | null>;
  canonicalId?: string;
  operationId?: { camel: string; snake: string };
}

const ALL = vectors as Vector[];

function find(id: string): Vector {
  const found = ALL.find((v) => v.id === id);
  if (!found) throw new Error(`missing vector ${id}`);
  return found;
}

function ids(language: Language, name: Name): string | null {
  return identifier(name, language) ?? null;
}

/** The mismatches of one vector against the implementation, empty when it passes. */
function check(v: Vector): string[] {
  const problems: string[] = [];
  const result = v.owner
    ? ({ ok: true, segments: v.owner } as const)
    : segmentsOf(v.written as string, v.source as "name", {
        ...(v.codeName !== undefined ? { codeName: v.codeName } : {}),
        ...(v.position !== undefined ? { position: v.position } : {}),
      });
  if (v.error !== undefined) {
    if (result.ok) problems.push(`${v.id}: expected error ${v.error}, got ${result.segments}`);
    else if (result.reason !== v.error) problems.push(`${v.id}: reason ${result.reason}`);
    return problems;
  }
  if (!result.ok) return [`${v.id}: unexpected error ${result.reason}`];
  expect(result.segments, v.id).toEqual(v.segments);
  const name = deriveName(result.segments, v.role, v.status);
  for (const language of LANGUAGES) {
    const got = ids(language, name);
    const want = v.expected?.[language];
    if (got !== want) problems.push(`${v.id} ${language}: expected ${want}, got ${got}`);
  }
  if (v.canonicalId !== undefined && canonicalId(name) !== v.canonicalId) {
    problems.push(`${v.id} canonicalId: expected ${v.canonicalId}, got ${canonicalId(name)}`);
  }
  if (v.operationId) {
    for (const idCase of ["camel", "snake"] as const) {
      const got = canonicalId(name, { operationIdCase: idCase });
      if (got !== v.operationId[idCase]) problems.push(`${v.id} ${idCase}: got ${got}`);
    }
  }
  return problems;
}

const name = (segments: string[], role: Role, status?: number) =>
  deriveName(segments, role, status);

describe("naming", () => {
  test("adr 0007 examples", () => {
    // Section 2.
    expect(splitName("userId")).toEqual(["user", "id"]);
    expect(splitName("HTTPServer")).toEqual(["http", "server"]);
    expect(splitName("userID")).toEqual(["user", "id"]);
    expect(splitName("oauth2Token")).toEqual(["oauth2", "token"]);
    expect(splitName("v2")).toEqual(["v2"]);
    // Section 3 table, through the canonical id and every language.
    const table: [string[], Role, string, number?][] = [
      [["assign", "task"], "input", "AssignTaskInput"],
      [["create", "task"], "response", "CreateTaskResponse201", 201],
      [["list", "tasks"], "query", "ListTasksQuery"],
      [["tasks", "update"], "params", "TasksUpdateParams"],
      [["api", "rate", "limited"], "params", "ApiRateLimitedParams"],
      [["tasks", "locked"], "error", "TasksLockedError"],
      [["update", "task"], "errors", "UpdateTaskErrors"],
      [["1042"], "params", "_1042Params"],
      [["order", "address"], "property", "OrderAddress"],
      [["notice", "assigned"], "variant", "NoticeAssigned"],
      [["tasks"], "endpoints", "TasksEndpoints"],
      [["assign", "task"], "operation", "assignTask"],
    ];
    for (const [owner, role, expected, status] of table) {
      const n = name(owner, role, status);
      for (const language of LANGUAGES) expect(identifier(n, language), expected).toBe(expected);
      expect(canonicalId(n)).toBe(expected);
      // Each example is also a vector of the shared file.
      expect(
        ALL.some(
          (v) =>
            v.owner?.join() === owner.join() && v.role === role && v.expected?.php === expected,
        ),
        `vector for ${expected}`,
      ).toBe(true);
    }
    // Section 4 table: [assign, task] + input.
    const assign = name(["assign", "task"], "input");
    expect(identifier(assign, "typescript")).toBe("AssignTaskInput");
    // Section 5: List per language.
    const list = name(["list"], "schema");
    expect(LANGUAGES.map((l) => identifier(list, l))).toEqual(["List", "List_", "List_", "List_"]);
    expect(find("reserved/schema-list").expected).toEqual({
      typescript: "List",
      kotlin: "List_",
      java: "List_",
      php: "List_",
    });
    // Section 6 vector sample.
    expect(find("reserved/schema-list").segments).toEqual(["list"]);
  });

  test("vectors pass for every language", () => {
    expect(ALL.length).toBeGreaterThan(100);
    const problems = ALL.flatMap(check);
    expect(problems).toEqual([]);
  });

  test("vectors file matches its schema", () => {
    const validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(
      schema,
    );
    expect(validate(vectors) ? [] : validate.errors).toEqual([]);
    const idList = ALL.map((v) => v.id);
    expect(new Set(idList).size).toBe(idList.length);
    const sorted = [...idList].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(idList).toEqual(sorted);
    // The schema rejects what the decisions forbid.
    const ok = find("derived/response-201");
    const { position: _position, ...noPosition } = find("enum-fallback/plain-value");
    const bad: unknown[] = [
      noPosition,
      { ...ok, status: 404 },
      { ...ok, status: 199 },
      { ...ok, status: "201" },
      { ...ok, status: undefined },
      { ...find("derived/input"), status: 200 },
      {
        ...find("digits/enum-member-2fa"),
        expected: { typescript: "x", kotlin: "A", java: "A", php: "A" },
      },
      {
        ...find("derived/input"),
        expected: { ...find("derived/input").expected, typescript: null },
      },
    ];
    for (const v of bad) expect(validate([v]), JSON.stringify(v)).toBe(false);
  });

  test("reserved-words.json matches its schema and is sorted", () => {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(reservedSchema);
    expect(validate(reservedWords) ? [] : validate.errors).toEqual([]);
    const served = Object.values(reservedWords.lists).flatMap((l) => l.usedBy);
    expect([...served].sort()).toEqual([...LANGUAGES].sort());
    // A shared list is no longer possible: each list serves its own key.
    for (const [language, list] of Object.entries(reservedWords.lists)) {
      expect(list.usedBy, language).toEqual([language]);
    }
    const lists = Object.values(reservedWords.lists);
    for (const list of lists) {
      if (!list.caseInsensitive) continue;
      for (const words of [list.keywords, list.types, list.members, list.enumMembers]) {
        expect(
          words.filter((w) => w !== w.toLowerCase()),
          "a caseInsensitive list is lowercase",
        ).toEqual([]);
      }
    }
    for (const list of lists) {
      for (const words of [list.keywords, list.types, list.members, list.enumMembers]) {
        const sorted = [...new Set(words)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        expect(words).toEqual(sorted);
      }
    }
  });

  test("vectors cover the required cases", () => {
    // SCN-093, CHK-173.
    const covered = (category: string) => ALL.filter((v) => v.category === category).length;
    for (const category of [
      "splitting",
      "digits",
      "enum-fallback",
      "right",
      "reserved",
      "php-case",
      "derived",
    ]) {
      expect(covered(category), category).toBeGreaterThan(0);
    }
    const derivedRoles = new Set(ALL.filter((v) => v.category === "derived").map((v) => v.role));
    for (const role of ROLES.filter((r) => r !== "schema" && r !== "enumMember")) {
      expect(derivedRoles.has(role), `derived role ${role}`).toBe(true);
    }
    const schemas = new Set(
      ALL.filter((v) => v.role === "schema" && v.category === "reserved").map((v) => v.written),
    );
    for (const word of ["list", "match", "record", "error", "promise"]) {
      expect(schemas.has(word), word).toBe(true);
    }
    expect(find("digits/error-code-params-1042").expected?.php).toBe("_1042Params");
    expect(find("digits/error-code-error-404-gone").expected?.kotlin).toBe("_404GoneError");
    expect(find("enum-fallback/plus-at-3").segments).toEqual(["value3"]);
    expect(find("right/star-without-codeName").error).toBe("no-segment");
    expect(find("right/star-with-codeName").segments).toEqual(["wildcard"]);
    expect(find("derived/operation-list-tasks").operationId).toEqual({
      camel: "listTasks",
      snake: "list_tasks",
    });
  });

  test("reserved words escaped", () => {
    const cases: [string, Role, Language, string][] = [
      ["list", "schema", "kotlin", "List_"],
      ["error", "schema", "typescript", "Error_"],
      ["record", "schema", "java", "Record_"],
      ["promise", "schema", "typescript", "Promise_"],
      ["promise", "schema", "kotlin", "Promise"],
      ["class", "member", "typescript", "class_"],
      ["delete", "member", "typescript", "delete_"],
      ["delete", "member", "java", "delete"],
      ["val", "member", "kotlin", "val_"],
      ["val", "member", "java", "val"],
      ["let", "member", "typescript", "let_"],
    ];
    for (const [word, role, language, expected] of cases) {
      expect(identifier(name([word], role), language), `${word} ${language}`).toBe(expected);
    }
    // A shadowed type name does not escape a member; a keyword escapes both.
    expect(isReserved("Error", "typescript", "schema")).toBe(true);
    expect(isReserved("Error", "typescript", "member")).toBe(false);
    expect(isReserved("class", "typescript", "member")).toBe(true);
    // Every listed word is escaped for the roles it applies to, with the casing of its list.
    for (const language of LANGUAGES) {
      const list = Object.values(reservedWords.lists).find((l) =>
        (l.usedBy as string[]).includes(language),
      ) as (typeof reservedWords.lists)[Language];
      for (const word of list.keywords) {
        for (const role of ROLES)
          expect(isReserved(word, language, role), `${word} ${role}`).toBe(true);
      }
      for (const word of list.types) expect(isReserved(word, language, "schema"), word).toBe(true);
      for (const word of list.members)
        expect(isReserved(word, language, "member"), word).toBe(true);
      for (const word of list.enumMembers) {
        expect(isReserved(word, language, "enumMember"), word).toBe(true);
      }
    }
    // Minimal escaping: PHP keywords block type names (and the enum case `class`), not members.
    expect(identifier(name(["list"], "member"), "php")).toBe("list");
    expect(identifier(name(["list"], "enumMember"), "php")).toBe("List");
    expect(identifier(name(["class"], "enumMember"), "php")).toBe("Class_");
    expect(identifier(name(["this"], "member"), "php")).toBe("this_");
    expect(identifier(name(["hash", "code"], "member"), "java")).toBe("hashCode_");
    expect(identifier(name(["hash", "code"], "member"), "kotlin")).toBe("hashCode");
    expect(identifier(name(["val"], "member"), "java")).toBe("val");
    expect(identifier(name(["val"], "member"), "kotlin")).toBe("val_");
    expect(identifier(name(["optional"], "schema"), "kotlin")).toBe("Optional");
    expect(identifier(name(["optional"], "schema"), "java")).toBe("Optional_");
    expect(identifier(name(["constructor"], "member"), "typescript")).toBe("constructor_");
  });

  test("php case-insensitive reserved names", () => {
    for (const word of ["list", "LIST", "List", "lIsT", "Fn", "FN", "Match", "ARRAY"]) {
      expect(isReserved(word, "php", "schema"), word).toBe(true);
    }
    // Other languages compare exactly.
    expect(isReserved("LIST", "kotlin", "schema")).toBe(false);
    expect(isReserved("Class", "typescript", "member")).toBe(false);
    for (const written of ["list", "LIST", "List"]) {
      const segments = splitName(written);
      expect(identifier(name(segments, "schema"), "php")).toBe("List_");
    }
    expect(identifier(name(["class"], "enumMember"), "php")).toBe("Class_");
    expect(reservedWords.lists.php.caseInsensitive).toBe(true);
  });

  test("digit-led identifiers", () => {
    expect(identifier(name(["2fa"], "member"), "typescript")).toBe("_2fa");
    expect(identifier(name(["2fa"], "enumMember"), "kotlin")).toBe("_2FA");
    expect(identifier(name(["2fa"], "enumMember"), "typescript")).toBeUndefined();
    expect(identifier(name(["1042"], "params"), "php")).toBe("_1042Params");
    expect(identifier(name(["404", "gone"], "error"), "java")).toBe("_404GoneError");
    expect(identifier(name(["404", "gone"], "schema"), "typescript")).toBe("_404Gone");
    // Every role takes the leading underscore.
    for (const role of ROLES) {
      for (const language of LANGUAGES) {
        const got = identifier(
          name(["7up"], role, role === "response" ? 200 : undefined),
          language,
        );
        if (got !== undefined) expect(got.startsWith("_7"), `${role} ${language}`).toBe(true);
      }
    }
    // An operation id string is pure casing.
    expect(operationId(["2fa", "verify"])).toBe("2faVerify");
  });

  test("right without segments", () => {
    expect(segmentsOf("*", "right")).toEqual({ ok: false, reason: "no-segment" });
    expect(segmentsOf("*", "right", { codeName: "wildcard" })).toEqual({
      ok: true,
      segments: ["wildcard"],
    });
    expect(segmentsOf("*", "right", { codeName: "*" })).toEqual({
      ok: false,
      reason: "no-segment",
    });
    // A codeName without segment is an error for an enum value too, never the fallback.
    expect(segmentsOf("ok", "enumValue", { codeName: "+", position: 2 })).toEqual({
      ok: false,
      reason: "no-segment",
    });
    expect(segmentsOf("tasks.update", "right")).toEqual({
      ok: true,
      segments: ["tasks", "update"],
    });
    // The fallback is for enum values only.
    expect(segmentsOf("+", "enumValue", { position: 3 })).toEqual({
      ok: true,
      segments: ["value3"],
    });
    expect(segmentsOf("+", "name")).toEqual({ ok: false, reason: "no-segment" });
    // An enum value needs a positive integer position.
    for (const position of [undefined, 0, -1, 1.5, Number.NaN]) {
      expect(() =>
        segmentsOf("+", "enumValue", position === undefined ? {} : { position }),
      ).toThrow(/position/);
    }
    expect(() => segmentsOf("active", "enumValue")).toThrow(/position/);
  });

  test("splitName is total and yields only valid segments", () => {
    const samples = [
      "",
      "---",
      "A",
      "aA",
      "AAa",
      "a1A",
      "é",
      "\u0000x",
      "İstanbul",
      "ǅ",
      "x".repeat(50),
    ];
    let seed = 7;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed;
    };
    const alphabet = "aAzZ09_-. éİ\n";
    for (let n = 0; n < 500; n++) {
      let s = "";
      const length = next() % 12;
      for (let i = 0; i < length; i++) s += alphabet[next() % alphabet.length];
      samples.push(s);
    }
    for (const s of samples) {
      for (const segment of splitName(s)) expect(segment).toMatch(/^[a-z0-9]+$/);
    }
  });

  test("response suffix carries the status", () => {
    expect(suffixWords(name(["create", "task"], "response", 201))).toEqual(["response", "201"]);
    expect(suffixWords(name(["create", "task"], "input"))).toEqual(["input"]);
    expect(suffixWords(name(["order", "address"], "property"))).toEqual([]);
  });

  test("status is an integer, present exactly for a response", () => {
    expect(name(["create", "task"], "response", 201)).toEqual({
      segments: ["create", "task"],
      role: "response",
      status: 201,
    });
    expect("status" in name(["create", "task"], "input")).toBe(false);
    expect(name(["create", "task"], "input").status).toBeUndefined();
    const bad = (segments: string[], role: Role, status?: unknown) => () =>
      deriveName(segments, role, status as number);
    expect(bad(["a"], "response")).toThrow(/status/);
    expect(bad(["a"], "response", "201")).toThrow(/status/);
    expect(bad(["a"], "response", 20.5)).toThrow(/status/);
    // 200 to 399: success and redirect, what `responses` admits.
    for (const status of [100, 199, 400, 404, 599, 600]) {
      expect(bad(["a"], "response", status), String(status)).toThrow(/status/);
    }
    for (const status of [200, 204, 399]) {
      expect(bad(["a"], "response", status), String(status)).not.toThrow();
    }
    expect(bad(["a"], "input", 200)).toThrow(/no status/);
    // A hand-built name is checked by identifier, canonicalId and suffixWords too.
    const forged = (n: unknown) => n as Name;
    for (const fn of [
      (n: Name) => identifier(n, "typescript"),
      (n: Name) => canonicalId(n),
      (n: Name) => suffixWords(n),
    ]) {
      expect(() => fn(forged({ segments: ["a"], role: "response" }))).toThrow(/status/);
      expect(() => fn(forged({ segments: ["a"], role: "response", status: "201" }))).toThrow(
        /status/,
      );
      expect(() => fn(forged({ segments: ["a"], role: "input", status: 200 }))).toThrow(
        /no status/,
      );
    }
  });

  test("fails closed on a malformed name", () => {
    const forged = (segments: string[], role: string) => ({ segments, role }) as unknown as Name;
    for (const segments of [["Task"], ["a b"], ["a_b"], [""], ["é"]]) {
      expect(() => deriveName(segments, "schema"), segments.join()).toThrow(/segment/);
      expect(() => identifier(forged(segments, "schema"), "typescript")).toThrow(/segment/);
    }
    expect(() => operationId(["List"])).toThrow(/segment/);
    expect(() => operationId([])).toThrow(/segment/);
    // `segments` must be an array: a string would pass character by character.
    const text = "list" as unknown as string[];
    expect(() => operationId(text)).toThrow(/array/);
    expect(() => deriveName(text, "schema")).toThrow(/array/);
    expect(() => identifier({ segments: text, role: "schema" }, "typescript")).toThrow(/array/);
    expect(() =>
      identifier({ segments: "list", role: "schema" } as unknown as Name, "java"),
    ).toThrow(/array/);
    expect(() => deriveName("owner" as unknown as string[], "input")).toThrow(/array/);
    // An empty result has no identifier; a role with a suffix word still has one.
    expect(() => identifier(name([], "schema"), "typescript")).toThrow(/without segment/);
    expect(() => identifier(name([], "member"), "php")).toThrow(/without segment/);
    expect(identifier(name([], "endpoints"), "typescript")).toBe("Endpoints");
    // An unknown role (ADR 0005 open enums) is named in the error, never guessed.
    expect(() => deriveName(["a"], "widget" as Role)).toThrow(/"widget"/);
    expect(() => identifier(forged(["a"], "widget"), "java")).toThrow(/"widget"/);
    expect(() => isReserved("a", "java", "widget" as Role)).toThrow(/"widget"/);
    expect(() => isTypeRole("widget" as Role)).toThrow(/"widget"/);
    // An unknown language, including an inherited property name, is refused.
    for (const language of ["go", "constructor", "__proto__"]) {
      expect(() => identifier(name(["a"], "schema"), language as Language)).toThrow(/language/);
    }
    expect(() => suffixWords(name(["a"], "input"), { constructor: "x" } as never)).not.toThrow();
  });

  test("isTypeRole classifies every role", () => {
    const nonTypes = new Set<Role>(["operation", "member", "enumMember"]);
    for (const role of ROLES) expect(isTypeRole(role), role).toBe(!nonTypes.has(role));
  });

  test("options seam: suffixes, escape and enumCase", () => {
    const input = name(["assign", "task"], "input");
    expect(identifier(input, "java", { suffixes: { input: "dto" } })).toBe("AssignTaskDto");
    expect(identifier(input, "typescript", { suffixes: { input: "request" } })).toBe(
      "AssignTaskRequest",
    );
    // The status still follows the word of a response.
    expect(
      identifier(name(["create", "task"], "response", 201), "php", {
        suffixes: { response: "reply" },
      }),
    ).toBe("CreateTaskReply201");
    // Defaults reproduce the vectors.
    expect(identifier(input, "kotlin", {})).toBe(identifier(input, "kotlin"));
    expect(
      identifier(name(["list"], "schema"), "java", { escape: { position: "prefix", text: "_" } }),
    ).toBe("_List");
    expect(
      identifier(name(["list"], "schema"), "java", {
        escape: { position: "suffix", text: "Type" },
      }),
    ).toBe("ListType");
    expect(
      identifier(name(["class"], "member"), "typescript", {
        escape: { position: "prefix", text: "my" },
      }),
    ).toBe("myclass");
    // An enum member takes the casing asked for; TypeScript still has none.
    const ok = name(["in", "progress"], "enumMember");
    expect(identifier(ok, "kotlin", { enumCase: "pascal" })).toBe("InProgress");
    expect(identifier(ok, "php", { enumCase: "upperSnake" })).toBe("IN_PROGRESS");
    expect(identifier(ok, "java", { enumCase: "camel" })).toBe("inProgress");
    expect(identifier(ok, "typescript", { enumCase: "pascal" })).toBeUndefined();
    // The escape applies to the final identifier: camel `class` is a keyword.
    expect(identifier(name(["class"], "enumMember"), "kotlin", { enumCase: "camel" })).toBe(
      "class_",
    );
    // Malformed options throw.
    expect(() => identifier(input, "java", { suffixes: { input: "Dto" } })).toThrow(/suffix/);
    expect(() => identifier(input, "java", { suffixes: { input: "" } })).toThrow(/suffix/);
    expect(() => identifier(input, "java", { escape: { position: "suffix", text: "" } })).toThrow(
      /escape/,
    );
    expect(() => identifier(input, "java", { escape: { position: "prefix", text: "1x" } })).toThrow(
      /digit/,
    );
    expect(() =>
      identifier(input, "java", { escape: { position: "middle" as never, text: "_" } }),
    ).toThrow(/position/);
    expect(() => identifier(ok, "java", { enumCase: "kebab" as never })).toThrow(/enumCase/);
  });

  test("operation id casing", () => {
    expect(operationId(["list", "tasks"])).toBe("listTasks");
    expect(operationId(["list", "tasks"], "snake")).toBe("list_tasks");
    expect(operationId(["tasks", "list"], "camel")).toBe("tasksList");
  });

  test("no locale-dependent calls", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(sources.length).toBeGreaterThan(3);
    const forbidden = /toLocale\w*|localeCompare|Intl\./;
    for (const file of sources) {
      expect(readFileSync(`${dir}${file}`, "utf8"), file).not.toMatch(forbidden);
    }
  });
});
