import { defineTarget, type Target } from "@seampact/codegen-core";
import {
  CLIENT_ARTEFACT,
  type ClientArtefact,
  describeClient,
  type FetchClientOptions,
  parseFetchClientOptions,
} from "@seampact/codegen-fetch";
import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { generateAxiosClient } from "./generate.js";

// The axios client target, as the CLI loads it: the fetch client, sending through the app's axios instance. It
// provides the same `client` link, so the front targets run over it unchanged.
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
  generate: generateAxiosClient,
  describe: describeClient,
});
