import { createConfig, lintFromString } from "@redocly/openapi-core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { emitDocuments } from "./documents.js";
import { DEFAULT_EMITTER_OPTIONS } from "./emitter-options.js";
import {
  EXTENSION_NAMES,
  EXTENSION_PREFIX,
  extensionSchemaPath,
  isExtensionName,
} from "./extension-names.js";
import {
  createExtensionValidators,
  createOasValidator,
  extensionMembers,
  extensionSchemaFiles,
  goldenDocuments,
  goldenIrNames,
  readGoldenIr,
} from "./golden-documents.test-support.js";
import { mergeDocuments } from "./merge/index.js";

// The committed golden documents, which `scripts/golden --check` keeps equal to the emitter's output: each passes
// the OAS 3.1 schema, Redocly's recommended rules and the extension schemas.

const DOCUMENTS = goldenDocuments();

// A merged document of the reference workspace, linted like the golden documents; no golden document holds the two
// merged-only extensions.
const MERGED_REFERENCE = mergeDocuments(
  [{ ir: readGoldenIr("reference/tasks") }, { ir: readGoldenIr("reference/tasksService") }],
  { name: "reference", prefix: { tasksService: "service" }, emitter: DEFAULT_EMITTER_OPTIONS },
);
const MERGED_TEXTS =
  MERGED_REFERENCE.status === "merged"
    ? [{ path: "merged/reference.yaml", text: MERGED_REFERENCE.text }]
    : [];

// Recommended rules a golden document breaks for a reason of the contract, not of the emitter.
const REDOCLY_RULES_OFF: Record<string, string> = {
  "no-empty-servers":
    "servers come from the `servers` option, which the golden documents leave at its default",
  "operation-summary": "an operation's summary is its docs, which most golden routes leave out",
};

// Warnings a golden document may raise, each with its reason.
const REDOCLY_WARNINGS_ALLOWED: Record<string, string> = {
  "info-license": "the IR holds no license",
  "operation-2xx-response": "a form route of the bodies case answers a 303 redirect only",
  "no-illogical-composition-keywords":
    "a body-tagged variant holds no tag property (ADR 0004 section 5), so each `oneOf` branch adds it beside the variant's `$ref`, and the discriminator maps each tag to that variant",
};

describe("golden documents", () => {
  it("cover every golden IR", () => {
    const documentApis = new Set(
      DOCUMENTS.map(({ path }) => path.replace(/\/openapi\/([^./]+).*$/, "/$1")),
    );

    expect([...documentApis].sort()).toEqual(goldenIrNames());
  });

  it("golden documents match the OAS 3.1 schema", () => {
    const validate = createOasValidator();

    for (const { path, document } of DOCUMENTS) {
      expect({ path, problems: validate(document) }).toEqual({ path, problems: [] });
    }
  });

  it("the OAS 3.1 validator refuses a document that breaks it", () => {
    const validate = createOasValidator();

    expect(validate({ openapi: "3.1.0", info: { title: "t" }, paths: {} })).not.toEqual([]);
    expect(
      validate({
        openapi: "3.1.0",
        info: { title: "t", version: "1" },
        paths: {},
        components: { schemas: { Broken: { type: 12 } } },
      }),
    ).not.toEqual([]);
  });

  it("golden documents pass Redocly", async () => {
    const config = await createConfig({
      extends: ["recommended"],
      rules: Object.fromEntries(Object.keys(REDOCLY_RULES_OFF).map((rule) => [rule, "off"])),
    });

    expect(MERGED_REFERENCE.status).toBe("merged");

    for (const { path, text } of [...DOCUMENTS, ...MERGED_TEXTS]) {
      const problems = await lintFromString({ source: text, absoluteRef: `/${path}`, config });
      const unexpected = problems
        .filter(
          (problem) =>
            problem.severity === "error" || !(problem.ruleId in REDOCLY_WARNINGS_ALLOWED),
        )
        .map(
          (problem) =>
            `${problem.severity} ${problem.ruleId}: ${problem.message} at ${problem.location[0]?.pointer}`,
        );

      expect({ path, unexpected }).toEqual({ path, unexpected: [] });
    }
  }, 60_000);

  it("extension values match their schemas", () => {
    const validators = createExtensionValidators();

    for (const { path, document } of DOCUMENTS) {
      for (const member of extensionMembers(document)) {
        if (!member.key.startsWith(EXTENSION_PREFIX)) continue;

        const name = member.key.slice(EXTENSION_PREFIX.length);
        const validate = isExtensionName(name) ? validators.get(name) : undefined;
        const problems =
          validate === undefined ? [`${member.key} has no schema`] : validate(member.value);

        expect({ path, pointer: member.pointer, problems }).toEqual({
          path,
          pointer: member.pointer,
          problems: [],
        });
      }
    }
  });

  it("every extension schema is exercised", () => {
    expect(MERGED_REFERENCE.status).toBe("merged");

    const mergedDocuments = MERGED_TEXTS.map(({ text }) => parse(text));
    const used = new Set(
      [...DOCUMENTS.map(({ document }) => document), ...mergedDocuments].flatMap((document) =>
        extensionMembers(document).map((member) => member.key),
      ),
    );

    expect(EXTENSION_NAMES.filter((name) => !used.has(`${EXTENSION_PREFIX}${name}`))).toEqual([]);
    expect(extensionSchemaFiles()).toEqual(
      EXTENSION_NAMES.map((name) =>
        extensionSchemaPath(name).slice("schemas/extensions/".length),
      ).sort(),
    );
  });

  it("documents are byte-stable", () => {
    const committed = new Map(DOCUMENTS.map(({ path, text }) => [path, text]));
    const timeZone = process.env.TZ;
    const language = process.env.LANG;

    try {
      for (const environment of [{}, { TZ: "Pacific/Kiritimati", LANG: "tr_TR.UTF-8" }]) {
        Object.assign(process.env, environment);

        for (const name of goldenIrNames()) {
          const [caseName, apiName] = name.split("/");
          const outcome = emitDocuments(readGoldenIr(name));

          expect(outcome.status).toBe("emitted");

          if (outcome.status !== "emitted") continue;

          for (const document of outcome.documents) {
            const file =
              document.name === undefined ? `${apiName}.yaml` : `${apiName}.${document.name}.yaml`;

            expect(document.text).toBe(committed.get(`${caseName}/openapi/${file}`));
            expect(emitDocuments(readGoldenIr(name))).toEqual(outcome);
          }
        }
      }
    } finally {
      restoreEnvironment("TZ", timeZone);
      restoreEnvironment("LANG", language);
    }
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
