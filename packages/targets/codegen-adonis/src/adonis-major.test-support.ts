import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateReferenceProject,
  type ReferenceIrChange,
} from "@seampact/codegen-core/node-server/test-support";
import { target as adonisTarget } from "./index.js";

// Test support of the AdonisJS target: the shared reference project, generated against one AdonisJS major. The
// project's `node_modules` links that major's `@adonisjs/core` under its own name, over the package's.

const PACKAGE_MODULES = new URL("../node_modules/", import.meta.url);

/** The AdonisJS majors the target serves, each the devDependency that installs it. */
export const ADONIS_MAJORS = { 7: "@adonisjs/core", 6: "@adonisjs/core-6" } as const;

export type AdonisMajor = keyof typeof ADONIS_MAJORS;

/** Writes both reference apis' AdonisJS trees into a fresh project for one major; returns every file written. */
export async function generateAdonisProject(
  project: string,
  major: AdonisMajor,
  adonisOptions: Readonly<Record<string, unknown>>,
  changeIr?: ReferenceIrChange,
): Promise<string[]> {
  const files = await generateReferenceProject(project, adonisTarget, adonisOptions, changeIr);
  const link = join(project, "node_modules", "@adonisjs", "core");

  rmSync(link, { recursive: true, force: true });
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(fileURLToPath(new URL(ADONIS_MAJORS[major], PACKAGE_MODULES)), link, "dir");

  return files;
}
