import { defineTarget, type Target } from "@seampact/codegen-core";
import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { describeClient } from "./describe.js";
import { CLIENT_ARTEFACT, type ClientArtefact, generateClient } from "./generate.js";
import { type FetchClientOptions, parseFetchClientOptions } from "./options.js";

// The fetch client target, as the CLI loads it. It reads the operation types through the `types` link and
// provides the `client` link the front targets consume.
export const target: Target = defineTarget<FetchClientOptions, ClientArtefact, "types", "client">({
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
    artefacts: [{ id: CLIENT_ARTEFACT, defaultOn: true }],
    consumes: { types: { styles: ["typescript"] } },
    provides: { client: { style: "fetch" } },
  },
  format,
  parseOptions: parseFetchClientOptions,
  generate: generateClient,
  describe: describeClient,
});
