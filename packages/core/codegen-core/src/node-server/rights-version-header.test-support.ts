import type { ContractIR } from "@seampact/spec/ir";
import type { GenerateOutcome, GenerateRequest, Target } from "../target.js";
import { readGoldenIr } from "./reference-project.test-support.js";

const RIGHTS_VERSION_HEADER = "rightsVersion";
const SERVICE_IDENTITY = "service";
const HEADER_ORIGIN = { layer: "shared", pointer: "/headers/rightsVersion" } as const;
const USE_ORIGIN = {
  layer: "shared",
  pointer: "/identities/service/headers/rightsVersion",
} as const;

/** The operation of the tasksService api that the rights-version header is the only identity header of. */
export const RIGHTS_VERSION_OPERATION = "getTask";

/** The golden tasksService api whose service identity uses the rights-version header and no other (CHK-013). */
export function tasksServiceWithRightsVersionHeader(): ContractIR {
  const ir = readGoldenIr("tasksService");
  const identity = ir.identities[SERVICE_IDENTITY];

  if (identity === undefined || identity.kind !== "credential")
    throw new Error("the golden tasksService api has no credential identity 'service'");

  ir.headers[RIGHTS_VERSION_HEADER] = {
    id: RIGHTS_VERSION_HEADER,
    semantic: "versionToken",
    response: "X-Rights-Version",
    request: "If-Rights-Version",
    origin: HEADER_ORIGIN,
  };
  identity.headers = [
    { header: RIGHTS_VERSION_HEADER, for: "writes", required: false, origin: USE_ORIGIN },
  ];

  return ir;
}

/** The outcome of generating the tasksService api with the rights-version header on its service identity. */
export async function generateWithRightsVersionHeader(
  serverTarget: Target,
  where: { readonly links: GenerateRequest["links"]; readonly outputDirectory: string },
): Promise<GenerateOutcome> {
  return serverTarget.generate({
    ir: tasksServiceWithRightsVersionHeader(),
    options: {},
    links: where.links,
    outputDirectory: where.outputDirectory,
    artefacts: new Set(["boundary", "index"]),
  });
}
