import type { Target } from "@seampact/codegen-core";
import { nodeServerTarget } from "@seampact/codegen-core/node-server";
import { serverTargetCompatibility } from "@seampact/spec/compatibility";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { adonisModuleSource } from "./adonis-module.js";
import { vineOwnValidators } from "./vinejs/index.js";

// The AdonisJS target, as the CLI loads it. Its placement is a checked source of this package one directory above both
// `src` and `dist`, and the `adonis` module of each api; with no `validators` link it writes VineJS validators itself.
export const target: Target = nodeServerTarget({
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  format,
  placement: {
    runtimeModule: "adonis-boundary",
    runtimeSourceUrl: new URL("../runtime/adonis-boundary.ts", import.meta.url),
    frameworkModule: "adonis",
    frameworkSource: adonisModuleSource,
    ownValidators: vineOwnValidators,
  },
  validatorStyles: serverTargetCompatibility(packageJson.name).validatorStyles,
});
