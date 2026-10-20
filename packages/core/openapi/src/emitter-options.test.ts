import { type ContractIR, isKnownVariant } from "@seampact/spec/ir";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { emitDocuments } from "./documents.js";
import {
  DEFAULT_EMITTER_OPTIONS,
  type EmitterOptions,
  parseEmitterOptions,
} from "./emitter-options.js";
import { EXTENSION_PREFIX } from "./extension-names.js";
import { at, goldenIrNames, pointerToken, readGoldenIr } from "./golden-documents.test-support.js";
import { isJsonObject, type JsonValue } from "./json-value.js";

// The emitter options of A40 (CHK-136): each changes only what it names, and the defaults give the committed
// documents.

const REASON_MEMBERS = [
  "public",
  "optionalAuth",
  "exempt",
  "ignore",
  "keep",
  "reason",
  "x-seampact-opaque",
];
const INPUT_SUFFIX = ".input";

function documentsOf(irName: string, options: EmitterOptions): JsonValue[] {
  return documentsOfIr(readGoldenIr(irName), options);
}

function documentsOfIr(ir: ContractIR, options: EmitterOptions): JsonValue[] {
  const outcome = emitDocuments(ir, options);

  if (outcome.status !== "emitted") throw new Error(JSON.stringify(outcome.refusals));

  return outcome.documents.map((document) => parse(document.text));
}

function parsed(raw: unknown): EmitterOptions {
  const outcome = parseEmitterOptions(raw);

  if (outcome.status !== "parsed") throw new Error(JSON.stringify(outcome.refusals));

  return outcome.options;
}

/** The pointers where two values differ, down to the first differing member. */
function differences(left: unknown, right: unknown, pointer = ""): string[] {
  if (isJsonObject(left) && isJsonObject(right)) {
    const members = [...new Set([...Object.keys(left), ...Object.keys(right)])];

    return members.flatMap((member) =>
      differences(left[member], right[member], `${pointer}/${pointerToken(member)}`),
    );
  }

  if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) {
    return left.flatMap((item, index) => differences(item, right[index], `${pointer}/${index}`));
  }

  return JSON.stringify(left) === JSON.stringify(right) ? [] : [pointer];
}

function withoutExtensions(value: unknown, kept: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => withoutExtensions(item, kept));

  if (!isJsonObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([member]) =>
          !member.startsWith(EXTENSION_PREFIX) ||
          kept.includes(member.slice(EXTENSION_PREFIX.length)),
      )
      .map(([member, memberValue]) => [member, withoutExtensions(memberValue, kept)]),
  );
}

describe("emitter options change only what they name", () => {
  it("gives the committed documents with the defaults, written or left out", () => {
    for (const name of goldenIrNames()) {
      expect(documentsOf(name, parsed({}))).toEqual(documentsOf(name, DEFAULT_EMITTER_OPTIONS));
      expect(documentsOf(name, parsed(undefined))).toEqual(
        documentsOf(name, DEFAULT_EMITTER_OPTIONS),
      );
    }
  });

  it("keeps every x-seampact extension, none, or those listed", () => {
    for (const name of goldenIrNames()) {
      const all = documentsOf(name, DEFAULT_EMITTER_OPTIONS);

      expect(documentsOf(name, parsed({ extensions: "none" }))).toEqual(withoutExtensions(all, []));
      expect(documentsOf(name, parsed({ extensions: ["access", "paging"] }))).toEqual(
        withoutExtensions(all, ["access", "paging"]),
      );
    }
  });

  it("replaces each reason by true, or drops an optional one, under reasons: omit", () => {
    let changed = 0;

    for (const name of goldenIrNames()) {
      const included = documentsOf(name, DEFAULT_EMITTER_OPTIONS);
      const omitted = documentsOf(name, parsed({ reasons: "omit" }));

      for (const pointer of differences(included, omitted)) {
        const member = pointer.slice(pointer.lastIndexOf("/") + 1);
        const omittedValue = pointer
          .split("/")
          .slice(1)
          .map((step) => step.replaceAll("~1", "/").replaceAll("~0", "~"))
          .reduce<unknown>(
            (value, step) =>
              isJsonObject(value) || Array.isArray(value) ? Reflect.get(value, step) : undefined,
            omitted,
          );

        expect({ pointer, reasonMember: REASON_MEMBERS.includes(member) }).toEqual({
          pointer,
          reasonMember: true,
        });
        expect([true, undefined]).toContain(omittedValue);
        changed += 1;
      }
    }

    expect(changed).toBeGreaterThan(0);
  });

  it("writes servers and nothing else", () => {
    const servers = [{ url: "https://api.example.com", description: "Production" }];

    for (const name of goldenIrNames()) {
      const plain = documentsOf(name, DEFAULT_EMITTER_OPTIONS);
      const served = documentsOf(name, parsed({ servers }));

      expect(
        served.map((document) => (isJsonObject(document) ? document.servers : undefined)),
      ).toEqual(plain.map(() => servers));
      expect(differences(plain, served).every((pointer) => /^\/\d+\/servers$/.test(pointer))).toBe(
        true,
      );
    }
  });

  it("points request bodies at strict input components under inputSchemas: strict", () => {
    for (const name of goldenIrNames()) {
      const shared = documentsOf(name, DEFAULT_EMITTER_OPTIONS);
      const strict = documentsOf(name, parsed({ inputSchemas: "strict" }));

      for (const pointer of differences(shared, strict)) {
        const inBody = /^\/\d+\/paths\/[^/]+\/[a-z]+\/requestBody\//.test(pointer);
        const component = /^\/\d+\/components\/schemas\/([^/]+)$/.exec(pointer)?.[1];
        const addedInput = component?.endsWith(INPUT_SUFFIX) === true;

        expect({ pointer, allowed: inBody || addedInput }).toEqual({ pointer, allowed: true });
      }
    }

    const studio = documentsOf("extensions/studio", parsed({ inputSchemas: "strict" }))[0];

    expect(JSON.stringify(studio)).toContain('"$ref":"#/components/schemas/StreamEvent.input"');
  });

  it("closes an open enum at its input uses under inputSchemas: strict", () => {
    const ir = readGoldenIr("extensions/studio");
    const streamState = ir.enums.StreamState;
    const profile = ir.schemas.Profile;
    const updateProfile = ir.schemas.UpdateProfile;

    if (
      streamState === undefined ||
      profile === undefined ||
      updateProfile === undefined ||
      !isKnownVariant("Schema", profile) ||
      !isKnownVariant("Schema", updateProfile) ||
      profile.kind !== "object" ||
      updateProfile.kind !== "object"
    ) {
      throw new Error("the extensions case declares StreamState, Profile and UpdateProfile");
    }

    const stateProperty = profile.properties.find((property) => property.type.kind === "enum");

    if (stateProperty === undefined) throw new Error("Profile has an enum property");

    streamState.directions = ["input", "output"];
    updateProfile.properties.push(structuredClone(stateProperty));

    const [shared] = documentsOfIr(structuredClone(ir), DEFAULT_EMITTER_OPTIONS);
    const [strict] = documentsOfIr(ir, parsed({ inputSchemas: "strict" }));
    const stateSchema = (document: JsonValue | undefined, ...toObject: (string | number)[]) =>
      at(document, ...toObject, "properties", stateProperty.name);
    // The profile body has a proof, so strict input writes the input object in place in the body.
    const strictBodyObject = [
      "paths",
      "/v1/studios/{studioId}/profile",
      "patch",
      "requestBody",
      "content",
      "application/json",
      "schema",
      "allOf",
      0,
    ];

    expect(stateSchema(shared, "components", "schemas", "UpdateProfile")).toEqual({
      $ref: "#/components/schemas/StreamState",
    });
    expect(stateSchema(strict, ...strictBodyObject)).toEqual({
      $ref: "#/components/schemas/StreamState",
      enum: [...streamState.values],
    });
  });

  it("refuses an unknown option or extension name by name", () => {
    const outcome = parseEmitterOptions({
      extensions: ["access", "acces"],
      reasons: "hide",
      color: true,
    });

    expect(
      outcome.status === "refused" ? outcome.refusals.map((refusal) => refusal.member) : outcome,
    ).toEqual(["/color", "/extensions/1", "/reasons"]);
    expect(outcome.status === "refused" ? outcome.refusals[1]?.message : "").toContain("'acces'");
  });

  it("shows a refused value bounded, and an object by its kind", () => {
    const outcome = parseEmitterOptions({ reasons: { hide: true }, inputSchemas: "x".repeat(200) });
    const messages = outcome.status === "refused" ? outcome.refusals.map((r) => r.message) : [];

    expect(messages).toEqual([
      "An object is not a value of 'reasons'.",
      `'${"x".repeat(64)}...' is not a value of 'inputSchemas'.`,
    ]);
  });
});

describe("strict input still accepts proofs", () => {
  function bodyValidator(ir: ContractIR, path: string, method: string): (body: unknown) => boolean {
    const document = documentsOfIr(ir, parsed({ inputSchemas: "strict" }))[0];
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const documentId = "https://seampact.dev/test/document.json";
    const escapedPath = pointerToken(path);

    ajv.addSchema({ $id: documentId, ...(isJsonObject(document) ? document : {}) });

    const validate = ajv.compile({
      $ref: `${documentId}#/paths/${escapedPath}/${method}/requestBody/content/application~1json/schema`,
    });

    return (body) => validate(body) === true;
  }

  it("accepts a body with its proofs and refuses an unknown key beside them", () => {
    const accepts = bodyValidator(
      readGoldenIr("extensions/studio"),
      "/v1/studios/{studioId}/profile",
      "patch",
    );
    const profileId = "0b6e3c1a-5f2d-4e8b-9c7a-1d2e3f4a5b6c";

    expect(accepts({ profileId, displayName: "Ada", reauthToken: "token" })).toBe(true);
    expect(accepts({ profileId, displayName: "Ada" })).toBe(false);
    expect(accepts({ profileId, reauthToken: "token", nickname: "ada" })).toBe(false);
  });

  it("accepts a proof-only body and refuses an unknown key", () => {
    const accepts = bodyValidator(
      readGoldenIr("reference/tasks"),
      "/v1/channels/{channelId}/tasks/{taskId}/purge",
      "post",
    );

    expect(accepts({ reauthToken: "token" })).toBe(true);
    expect(accepts({ reauthToken: "token", force: true })).toBe(false);
  });

  it("accepts an unknown key beside the proofs when the input ignores unknown keys", () => {
    const ir = readGoldenIr("extensions/studio");
    const inputUse = ir.operations.find((operation) => operation.id === "profileStudio")?.input
      ?.schema;

    if (inputUse === undefined || !isKnownVariant("TypeUse", inputUse) || inputUse.kind !== "ref") {
      throw new Error("profileStudio reads a named input");
    }

    inputUse.unknownKeys = { policy: "ignore", reason: "Older clients send it." };

    const accepts = bodyValidator(ir, "/v1/studios/{studioId}/profile", "patch");
    const profileId = "0b6e3c1a-5f2d-4e8b-9c7a-1d2e3f4a5b6c";

    expect(accepts({ profileId, reauthToken: "token", nickname: "ada" })).toBe(true);
    expect(accepts({ profileId, displayName: "Ada" })).toBe(false);
  });
});
