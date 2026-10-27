import type { Target } from "@seampact/codegen-core";
import { nodeServerTarget } from "@seampact/codegen-core/node-server";
import { serverTargetCompatibility } from "@seampact/spec/compatibility";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { adonisModuleSource } from "./adonis-module.js";
import { vineOwnValidators } from "./vinejs/index.js";

// The AdonisJS target, as the CLI loads it. Its placement is the `adonis` module of each api, over the AdonisJS
// placement of `@seampact/server-runtime`; with no `validators` link it writes VineJS validators itself.
export const target: Target = nodeServerTarget({
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  format,
  placement: {
    frameworkModule: "adonis",
    frameworkSource: adonisModuleSource,
    ownValidators: vineOwnValidators,
    ownValidatorsTakeRules: true,
  },
  validatorStyles: serverTargetCompatibility(packageJson.name).validatorStyles,
  frameworkDocsOffFix: "this framework writes no document of its own; remove the key",
});
