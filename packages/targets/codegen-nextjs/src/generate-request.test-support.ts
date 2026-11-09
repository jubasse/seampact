import { fileURLToPath } from "node:url";
import type { GenerateRequest, LinkSet, Target } from "@seampact/codegen-core";
import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import { target as typesTarget } from "@seampact/codegen-ts";
import { target as zodTarget } from "@seampact/codegen-zod";
import type { ContractIR } from "@seampact/spec/ir";

// The request of a Next.js entry generating the reference `tasks` api: its types and zod links, and an output
// directory under this package, which resolves the workspace's runtime.

export const REFERENCE_API = "tasks";

const BOUNDARY = new Set(["boundary", "index"]);
const PACKAGE_DIRECTORY = fileURLToPath(new URL("..", import.meta.url));

/** The reference request, with `overrides` laid over it; the links follow the overriding IR. */
export function nextGenerateRequest(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  const ir = overrides.ir ?? readGoldenIr(REFERENCE_API);

  return {
    ir,
    options: {},
    links: linksOf(ir),
    artefacts: BOUNDARY,
    outputDirectory: PACKAGE_DIRECTORY,
    ...overrides,
  };
}

function linksOf(ir: ContractIR): LinkSet {
  const types = descriptorsOf(typesTarget, ir).types;
  const validators = descriptorsOf(zodTarget, ir).validators;

  if (types === undefined || validators === undefined) throw new Error("a link is missing");

  return {
    types: { descriptor: types, location: { kind: "relative", path: "../types" } },
    validators: { descriptor: validators, location: { kind: "relative", path: "../validators" } },
  };
}

function descriptorsOf(provider: Target, ir: ContractIR) {
  const described = provider.describe(ir, {});

  if (described.status !== "described") {
    throw new Error(`${provider.metadata.packageName} refused to describe ${REFERENCE_API}`);
  }

  return described.descriptors;
}
