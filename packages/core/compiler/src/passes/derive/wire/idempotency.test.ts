import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { loadWorkspace } from "../../../load/index.js";
import { loadMemoryReader } from "../../../load/reader.js";
import { treeNodesRelayedTasks } from "../../tree/nodes/test-support.js";
import {
  DERIVE_WIRE_FIXTURES,
  deriveWireDerivedHeaders,
  deriveWireFixtureVariant,
  deriveWireLoadFixture,
  deriveWireLocated,
  deriveWireOperation,
  deriveWireReferenceVariant,
  deriveWireResponseHeaders,
  deriveWireRunContract,
} from "./test-support.js";

const CONVENTION =
  "idempotency: { header: Idempotency-Key, replayHeader: Idempotency-Replayed, lifetime: 1h, methods: [post, delete] }";

const variant = (convention: string, ...more: [string, string][]) =>
  deriveWireRunContract(deriveWireFixtureVariant("wire", [[CONVENTION, convention], ...more]));

const keyParam = (run: ReturnType<typeof deriveWireRunContract>, id: string) =>
  deriveWireDerivedHeaders(run, id).filter(
    ([, , derivation]) => derivation === "idempotency.write",
  );

describe("idempotency key", () => {
  const run = deriveWireRunContract(deriveWireLoadFixture("wire"));

  test("a non-safe route whose method methods lists gets the key, its settings and the replay header", () => {
    expect(run.diagnostics).toEqual([]);
    expect(deriveWireOperation(run, "notes").idempotency).toEqual({
      kind: "derived",
      header: "Idempotency-Key",
      replayHeader: "Idempotency-Replayed",
      lifetimeMs: 3_600_000,
      required: true,
      enforce: "boundary",
      derivedFrom: {
        derivation: "idempotency.write",
        from: [{ layer: "api", pointer: "/conventions/idempotency" }],
      },
    });
    expect(keyParam(run, "notes")).toEqual([["Idempotency-Key", true, "idempotency.write"]]);
    expect(deriveWireResponseHeaders(run, "notes")[200]).toContain("Idempotency-Replayed");
    expect(keyParam(run, "comment")).toEqual([["Idempotency-Key", true, "idempotency.write"]]);
  });

  test("a method methods does not list, a safe route and a signed route get no key", () => {
    expect(deriveWireOperation(run, "bigNotes").idempotency).toBeUndefined();
    expect(deriveWireOperation(run, "board").idempotency).toBeUndefined();
    expect(deriveWireOperation(run, "stripe").idempotency).toBeUndefined();
    expect(keyParam(run, "stripe")).toEqual([]);
  });

  test("an exempt route the key reaches is written as the exemption, with no key", () => {
    expect(deriveWireOperation(run, "archive").idempotency).toEqual({
      kind: "exempt",
      reason: "Archiving twice leaves the note archived.",
      origin: { layer: "api", pointer: "/surfaces/app/routes/archive/idempotency" },
    });
    expect(keyParam(run, "archive")).toEqual([]);
  });

  test("required: false makes the key optional", () => {
    const optional = variant(CONVENTION.replace(" }", ", required: false }"));

    expect(optional.diagnostics).toEqual([]);
    expect(keyParam(optional, "notes")).toEqual([["Idempotency-Key", false, "idempotency.write"]]);
    expect(deriveWireOperation(optional, "notes").idempotency).toMatchObject({ required: false });
  });

  test("enforce: none declares the key without a replay header", () => {
    const none = variant(CONVENTION.replace(" }", ", enforce: none }"));

    expect(none.diagnostics).toEqual([]);
    expect(deriveWireOperation(none, "notes").idempotency).toMatchObject({ enforce: "none" });
    expect(keyParam(none, "notes")).toHaveLength(1);
    expect(deriveWireResponseHeaders(none, "notes")[200]).not.toContain("Idempotency-Replayed");
  });

  test("methods defaults to every non-safe method", () => {
    const every = variant(CONVENTION.replace(", methods: [post, delete]", ""));

    expect(keyParam(every, "bigNotes")).toEqual([["Idempotency-Key", true, "idempotency.write"]]);
  });

  test("an unset convention derives no key", () => {
    const unset = variant("", [
      '        idempotency: { exempt: "Archiving twice leaves the note archived." }\n',
      "",
    ]);

    expect(unset.diagnostics).toEqual([]);
    expect(unset.draft.operations.some((operation) => operation.idempotency !== undefined)).toBe(
      false,
    );
  });

  test("an exemption the key does not reach is refused, naming the unused reason", () => {
    const unset = variant("");
    const onRead = variant(CONVENTION, [
      "      board:\n        method: get\n",
      '      board:\n        method: get\n        idempotency: { exempt: "Reads repeat anyway." }\n',
    ]);
    const onSigned = variant(CONVENTION, [
      "stripe: { method: post, identity: stripe, input: Note }",
      'stripe: { method: post, identity: stripe, input: Note, idempotency: { exempt: "Stripe retries." } }',
    ]);

    expect(unset.diagnostics.map(deriveWireLocated)).toEqual([
      {
        rule: "seampact/derive/idempotency-exempt-unused",
        pointer: "/surfaces/app/routes/archive/idempotency",
        related: [],
      },
    ]);
    expect(unset.diagnostics[0]?.message).toContain("Archiving twice leaves the note archived.");
    expect(onRead.diagnostics.map(deriveWireLocated)).toEqual([
      {
        rule: "seampact/derive/idempotency-exempt-unused",
        pointer: "/surfaces/app/routes/board/idempotency",
        related: [],
      },
    ]);
    expect(onSigned.diagnostics.map((item) => item.origin.pointer)).toEqual([
      "/surfaces/hooks/routes/stripe/idempotency",
    ]);
  });

  test("an exemption inherited by a route the key reaches is used", () => {
    const inherited = variant(CONVENTION, [
      "    identity: robot\n",
      '    identity: robot\n    idempotency: { exempt: "Robots retry with their own job ids." }\n',
    ]);

    expect(inherited.diagnostics).toEqual([]);
    expect(deriveWireOperation(inherited, "jobs").idempotency).toMatchObject({
      kind: "exempt",
      origin: { pointer: "/surfaces/robots/idempotency" },
    });
  });

  test("a convention without header, replayHeader or lifetime is refused", () => {
    const incomplete = variant("idempotency: { header: Idempotency-Key, methods: [post] }");

    expect(incomplete.diagnostics.map(deriveWireLocated)).toEqual([
      {
        rule: "seampact/derive/idempotency-convention",
        pointer: "/conventions/idempotency",
        related: [],
      },
    ]);
    expect(incomplete.diagnostics[0]?.message).toContain("sets no replayHeader, lifetime");
    expect(deriveWireOperation(incomplete, "notes").idempotency).toBeUndefined();
  });

  test("a lifetime no safe integer of milliseconds holds is refused", () => {
    const tooLong = variant(CONVENTION.replace("lifetime: 1h", "lifetime: 999999999999999d"));

    expect(tooLong.diagnostics.map(deriveWireLocated)).toEqual([
      {
        rule: "seampact/derive/idempotency-convention",
        pointer: "/conventions/idempotency",
        related: [],
      },
    ]);
    expect(tooLong.diagnostics[0]?.message).toContain("longer than any duration");
  });
});

describe("relay routes carry the public operation's method", () => {
  const SURFACE = "    prefix: /internal/v{version}\n";
  const EXEMPT = `${SURFACE}    idempotency: { exempt: "Relayed calls carry the public key." }\n`;
  const ROUTE = "      getTask: { relays: tasks.getTask }\n";
  const WITH_ASSIGN = `${ROUTE}      assignTask: { relays: tasks.assignTask }\n`;

  const relayRun = (...replacements: [string, string][]) =>
    deriveWireRunContract(
      deriveWireReferenceVariant("tasks-service/api.yaml", replacements),
      "tasksService",
      treeNodesRelayedTasks(),
    );

  test("an exemption a relay route inherits and uses is not refused", () => {
    const run = relayRun([SURFACE, EXEMPT], [ROUTE, WITH_ASSIGN]);

    expect(run.diagnostics).toEqual([]);
    expect(deriveWireOperation(run, "assignTask").idempotency).toMatchObject({
      kind: "exempt",
      reason: "Relayed calls carry the public key.",
      origin: { pointer: "/surfaces/internal/idempotency" },
    });
  });

  test("an exemption no relay route uses is refused as unused", () => {
    const run = relayRun([SURFACE, EXEMPT]);

    expect(run.diagnostics.map(deriveWireLocated)).toEqual([
      {
        rule: "seampact/derive/idempotency-exempt-unused",
        pointer: "/surfaces/internal/idempotency",
        related: [],
      },
    ]);
    expect(deriveWireOperation(run, "getTask").idempotency).toBeUndefined();
  });
});

describe("convention values the authoring schema refuses", () => {
  // Loaded without the validate stage, which refuses each of these values.
  const unvalidated = (from: string, to: string) => {
    const text = readFileSync(`${DERIVE_WIRE_FIXTURES}wire/api.yaml`, "utf8");

    if (!text.includes(from)) throw new Error(`the wire fixture holds no '${from}'`);

    const loaded = loadWorkspace({
      reader: loadMemoryReader({ "api.yaml": text.replace(from, to) }),
      entry: "api.yaml",
    });

    return () => deriveWireRunContract(loaded.workspace);
  };

  test.each([
    [
      "methods: [post, delete]",
      "methods: [post, delete], enforce: sometimes",
      /enforce is "sometimes"/,
    ],
    ["header: Idempotency-Key", "header: 5", /idempotency.header is no string/],
  ])("%s as %s throws", (from, to, error) => {
    expect(unvalidated(from, to)).toThrow(error);
  });
});
