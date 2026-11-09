import type { GenerateRequest, LinkSet } from "@seampact/codegen-core";
import {
  generateReferenceProject,
  readGoldenIr,
  referenceLinks,
} from "@seampact/codegen-core/node-server/test-support";
import { target } from "./index.js";

// The request of a Next.js entry generating the reference `tasks` api: its types and zod links, read from a
// reference project of the calling test file, which links the workspace's providers and runtime, and that project
// as output directory. Each test file has its own project, since test files run in parallel.

export const REFERENCE_API = "tasks";

const BOUNDARY = new Set(["boundary", "index"]);
const referenceLinksByProject = new Map<string, Promise<LinkSet>>();

/** The reference request generated in `project`, with `overrides` laid over it. */
export async function nextGenerateRequest(
  project: string,
  overrides: Partial<GenerateRequest> = {},
): Promise<GenerateRequest> {
  return {
    ir: readGoldenIr(REFERENCE_API),
    options: {},
    links: await linksOfReferenceProject(project),
    artefacts: BOUNDARY,
    outputDirectory: project,
    ...overrides,
  };
}

function linksOfReferenceProject(project: string): Promise<LinkSet> {
  const generated =
    referenceLinksByProject.get(project) ??
    generateReferenceProject(project, target, {}).then(() =>
      referenceLinks(project, REFERENCE_API),
    );

  referenceLinksByProject.set(project, generated);

  return generated;
}
