// Writes or checks the skills folder: the references generated from docs/, and the mirror shipped in the CLI package.
//   node scripts/skills/cli.ts (--write | --check)

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  CLI_SKILLS_DIRECTORY,
  expectedSkillTree,
  GENERATE_COMMAND,
  SKILLS_DIRECTORY,
  treeProblems,
  writeSkillTree,
} from "./skill-tree.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const USAGE = "usage: node scripts/skills/cli.ts (--write | --check)";

const { values } = parseArgs({
  options: { write: { type: "boolean" }, check: { type: "boolean" } },
});

if (values.write === values.check) {
  console.error(USAGE);
  process.exit(2);
}

const tree = expectedSkillTree(REPO_ROOT);

if (values.write === true) {
  writeSkillTree(tree, REPO_ROOT);
  console.log(
    `skills: ${tree.size} files written in ${SKILLS_DIRECTORY}/ and ${CLI_SKILLS_DIRECTORY}/`,
  );
  process.exit(0);
}

const problems = [SKILLS_DIRECTORY, CLI_SKILLS_DIRECTORY].flatMap((directory) =>
  treeProblems(tree, REPO_ROOT, directory),
);

if (problems.length > 0) {
  console.error(`skills: out of date; run \`${GENERATE_COMMAND}\`\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

console.log(`skills: ${tree.size} files up to date`);
