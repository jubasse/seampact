import { defineTarget, type Target } from "@seampact/codegen-core";
import { clientTargetCompatibility } from "@seampact/spec/compatibility";
import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import {
  type AngularArtefact,
  generateAngularQueries,
  QUERIES_ARTEFACT,
  SERVICE_ARTEFACT,
} from "./generate.js";
import { type AngularQueryOptions, parseAngularQueryOptions } from "./options.js";

// The angular target, as the CLI loads it. It reads every type through the `client` link, which `codegen-fetch`
// provides.
export const target: Target = defineTarget<AngularQueryOptions, AngularArtefact, "client">({
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
    artefacts: [
      { id: QUERIES_ARTEFACT, defaultOn: true },
      { id: SERVICE_ARTEFACT, defaultOn: true, needs: [QUERIES_ARTEFACT] },
    ],
    consumes: { client: { styles: clientTargetCompatibility(packageJson.name).clientStyles } },
    provides: {},
  },
  format,
  parseOptions: parseAngularQueryOptions,
  generate: generateAngularQueries,
});
