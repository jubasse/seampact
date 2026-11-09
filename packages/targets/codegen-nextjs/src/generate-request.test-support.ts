import type { GenerateRequest, LinkSet } from "@seampact/codegen-core";
import {
  generateReferenceProject,
  projectDirectory,
  readGoldenIr,
  referenceLinks,
} from "@seampact/codegen-core/node-server/test-support";
import { target } from "./index.js";

// The request of a Next.js entry generating the reference `tasks` api: its types and zod links, read from the
// reference project, which links the workspace's providers and runtime, and that project as output directory.

export const REFERENCE_API = "tasks";

const BOUNDARY = new Set(["boundary", "index"]);
const PROJECT = projectDirectory(import.meta.url, "next-generate-request");

let referenceLinksOnce: Promise<LinkSet> | undefined;

/** The reference request, with `overrides` laid over it. */
export async function nextGenerateRequest(
  overrides: Partial<GenerateRequest> = {},
): Promise<GenerateRequest> {
  return {
    ir: readGoldenIr(REFERENCE_API),
    options: {},
    links: await linksOfReferenceProject(),
    artefacts: BOUNDARY,
    outputDirectory: PROJECT,
    ...overrides,
  };
}

function linksOfReferenceProject(): Promise<LinkSet> {
  referenceLinksOnce ??= generateReferenceProject(PROJECT, target, {}).then(() =>
    referenceLinks(PROJECT, REFERENCE_API),
  );

  return referenceLinksOnce;
}
