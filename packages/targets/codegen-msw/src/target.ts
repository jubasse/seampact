import { defineTarget, type Target } from "@seampact/codegen-core";
import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { generateMocks, HANDLERS_ARTEFACT, type MswArtefact } from "./generate.js";
import { type MswMockOptions, parseMswMockOptions } from "./options.js";

// The MSW target, as the CLI loads it. It reads the operation types through the `types` link, as the fetch client
// does, and writes the answers the client reads.
export const target: Target = defineTarget<MswMockOptions, MswArtefact, "types">({
  metadata: {
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    role: "client",
    irSupport: {
      irVersions: [IR_VERSION],
      irRevision: IR_REVISION,
      kinds: ["httpOperation"],
      features: [],
    },
    artefacts: [{ id: HANDLERS_ARTEFACT, defaultOn: true }],
    consumes: { types: { styles: ["typescript"] } },
    provides: {},
  },
  format,
  parseOptions: parseMswMockOptions,
  generate: generateMocks,
});
