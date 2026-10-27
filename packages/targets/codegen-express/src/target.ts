import type { Target } from "@seampact/codegen-core";
import { nodeServerTarget, PACKAGED_RUNTIME } from "@seampact/codegen-core/node-server";
import { serverTargetCompatibility } from "@seampact/spec/compatibility";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { expressModuleSource } from "./express-module.js";

// The Express target, as the CLI loads it. Its placement is the `express` module of each api, over the Express
// placement of `@seampact/server-runtime`.
export const target: Target = nodeServerTarget({
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  format,
  placement: {
    runtimeSource: PACKAGED_RUNTIME,
    frameworkModule: "express",
    frameworkSource: expressModuleSource,
  },
  validatorStyles: serverTargetCompatibility(packageJson.name).validatorStyles,
  frameworkDocsOffFix: "this framework writes no document of its own; remove the key",
});
