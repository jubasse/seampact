import type { ArtefactDeclaration, Target } from "@seampact/codegen-core";
import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";

// A resolved target for the config checks' tests: its package and artefacts only; it generates nothing.
export function stubTarget(
  packageName: string,
  artefacts: readonly ArtefactDeclaration[] = [{ id: "boundary", defaultOn: true }],
): Target {
  return {
    metadata: {
      packageName,
      packageVersion: "1.0.0",
      role: "server",
      irSupport: { irVersions: [IR_VERSION], irRevision: IR_REVISION, kinds: [], features: [] },
      artefacts,
      consumes: {},
      provides: {},
    },
    parseOptions: () => ({ status: "parsed", options: {} }),
    generate: async () => ({ status: "generated", files: [] }),
    describe: () => ({ status: "described", descriptors: {} }),
  };
}
