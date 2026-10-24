import { defineTarget, type Target } from "@seampact/codegen-core";
import { clientTargetCompatibility } from "@seampact/spec/compatibility";
import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import {
  generateReactQueries,
  HOOKS_ARTEFACT,
  ITEMS_OF_ARTEFACT,
  QUERIES_ARTEFACT,
  type ReactArtefact,
} from "./generate.js";
import { parseReactQueryOptions, type ReactQueryOptions } from "./options.js";

// The react target, as the CLI loads it. It reads every type through the `client` link, which `codegen-fetch`
// provides.
export const target: Target = defineTarget<ReactQueryOptions, ReactArtefact, "client">({
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
      { id: HOOKS_ARTEFACT, defaultOn: true, needs: [QUERIES_ARTEFACT] },
      { id: ITEMS_OF_ARTEFACT, defaultOn: false, needs: [QUERIES_ARTEFACT] },
    ],
    consumes: { client: { styles: clientTargetCompatibility(packageJson.name).clientStyles } },
    provides: {},
  },
  format,
  parseOptions: parseReactQueryOptions,
  generate: generateReactQueries,
});
