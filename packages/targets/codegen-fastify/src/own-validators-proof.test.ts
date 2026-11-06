import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LinkSet } from "@seampact/codegen-core";
import {
  GENERATE_TIMEOUT_MILLISECONDS,
  generateReferenceProject,
  projectDirectory,
  readGoldenIr,
  referenceLinks,
  referenceServerOutput,
} from "@seampact/codegen-core/node-server/test-support";
import { beforeAll, expect, test } from "vitest";
import { target as fastifyTarget } from "./index.js";

const PROJECT = projectDirectory(import.meta.url, "own-validators-proof");
const OWN_VALIDATORS = join(PROJECT, "generated/own-validators/tasks");
const CHANNEL_ID_ISSUE = ["path", "channelId"];
const TITLE_ISSUE = ["body", "title"];

let operationInputPath = "";

async function typesLinkOnly(): Promise<LinkSet> {
  const { types } = await referenceLinks(PROJECT, "tasks");

  return { ...(types === undefined ? {} : { types }) };
}

beforeAll(async () => {
  await generateReferenceProject(PROJECT, fastifyTarget, { bodyValidation: true });

  const outcome = await fastifyTarget.generate({
    ir: readGoldenIr("tasks"),
    options: { bodyValidation: true },
    links: await typesLinkOnly(),
    outputDirectory: referenceServerOutput(PROJECT, "tasks"),
    artefacts: new Set(["boundary", "index", "validators"]),
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  for (const file of outcome.files.filter((generated) =>
    generated.path.startsWith("validators/"),
  )) {
    const path = join(OWN_VALIDATORS, file.path);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.contents);
  }

  operationInputPath = join(OWN_VALIDATORS, "validators/operations/input.ts");
}, GENERATE_TIMEOUT_MILLISECONDS);

test("without a validators link one Ajv validator checks the whole request and reports every issue", async () => {
  const { CreateTaskInputSchema } = await import(operationInputPath);
  const result = await CreateTaskInputSchema["~standard"].validate({
    path: { channelId: "not-a-uuid" },
    query: {},
    headers: {},
    body: { title: "x".repeat(201) },
  });
  const issuePaths: unknown[][] = result.issues.map((issue: { path: unknown[] }) => issue.path);

  expect(issuePaths).toContainEqual(CHANNEL_ID_ISSUE);
  expect(issuePaths).toContainEqual(TITLE_ISSUE);
});
