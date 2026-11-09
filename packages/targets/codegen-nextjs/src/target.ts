import { mountedBasePaths, type Refusal, type Target } from "@seampact/codegen-core";
import { nodeServerTarget, type PlacementEntry } from "@seampact/codegen-core/node-server";
import { serverTargetCompatibility } from "@seampact/spec/compatibility";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { NEXT_IMPORT_SPECIFIERS, NEXT_MODULE, nextModuleSource } from "./next-module.js";

// The Next.js target, as the CLI loads it. Its placement is the `next` module of each api, over the Next.js
// placement and the Web-standard modules of `@seampact/server-runtime`. The app routes each api to its catch-all
// route files by base path, so two apis may not share or nest one.
export const target: Target = nodeServerTarget({
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  format,
  placement: {
    frameworkModule: NEXT_MODULE,
    frameworkSource: nextModuleSource,
    entryRefusals: nextEntryRefusals,
  },
  validatorStyles: serverTargetCompatibility(packageJson.name).validatorStyles,
  frameworkDocsOffFix: "this framework writes no document of its own; remove the key",
  importSpecifiers: NEXT_IMPORT_SPECIFIERS,
  exclusiveBasePaths: true,
});

const NO_BASE_PATH = "";

// What a Next.js entry asks and the placement cannot serve: no framework-route boot check reads the app's routes on
// Next.js (ADR 0030 "The boot check"), a catch-all route file at the app's root, and an unserved path left to an app
// whose only route of the api is the catch-all.
function nextEntryRefusals(entry: PlacementEntry): Refusal[] {
  return [
    ...frameworkRouteRefusals(entry),
    ...emptyBasePathRefusals(entry),
    ...catchAllRefusals(entry),
  ];
}

function frameworkRouteRefusals(entry: PlacementEntry): Refusal[] {
  const check = entry.frameworkRoutes;

  if (check.status === "off") return [];

  if (check.allowed.length > 0) {
    return [
      {
        code: "frameworkRoutes.unsupported",
        message:
          "The entry allow-lists 'frameworkRoutes', but no check reads a Next.js app's routes: Next.js gives a route handler no list of them.",
        fix: "Remove 'frameworkRoutes' and keep the app's own route files and rewrites outside the api's base paths.",
      },
    ];
  }

  if (check.written !== true) return [];

  return [
    {
      code: "artefacts.bootCheck.frameworkRoutes.unsupported",
      message:
        "The entry sets 'artefacts.bootCheck.frameworkRoutes', but Next.js has no framework-route boot check: no check reads the app's routes.",
      fix: "Set 'artefacts.bootCheck.frameworkRoutes' to false or remove it.",
    },
  ];
}

function emptyBasePathRefusals(entry: PlacementEntry): Refusal[] {
  if (!mountedBasePaths(entry.ir, entry.mount).includes(NO_BASE_PATH)) return [];

  return [
    {
      code: "path.base.empty.unsupported",
      message:
        "The api is served under an empty base path, so its catch-all route file would sit at the app's root and take every page.",
      fix: "Give the api a base path, through its surface prefix or the entry's 'mount'.",
    },
  ];
}

function catchAllRefusals(entry: PlacementEntry): Refusal[] {
  if (entry.options.catchAll) return [];

  return [
    {
      code: "options.catchAll.unsupported",
      message:
        "The entry sets 'catchAll: false', but on Next.js the api's catch-all route file is its only route: no app route could serve a path it leaves.",
      fix: "Remove 'catchAll' or set it to true.",
    },
  ];
}
