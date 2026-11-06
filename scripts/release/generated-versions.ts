// The generated side of the stamp: the generator version each committed golden tree embeds. A generator writes its
// runtime's version constant (the JVM generator the build's `version`) into the code it emits, and the runtime
// refuses code stamped for another version, so the goldens follow the stamp. The stamp rewrites the version in
// place; the tree's own golden update (`regenerate`) writes the same text from the generator.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ReleaseError } from "./release-version.ts";
import { readRepositoryFile, type VersionEdit } from "./version-edit.ts";

interface GeneratedVersionForm {
  /** Global and multiline: the text before the version, the version, the text after it. */
  readonly line: RegExp;
  readonly field: string;
  readonly extension: string;
}

interface GoldenTree {
  /** Repository-relative directory, walked recursively. */
  readonly directory: string;
  readonly form: GeneratedVersionForm;
  readonly regenerate: string;
}

const PYTHON_GENERATED_BY: GeneratedVersionForm = {
  line: /^( *generated_by ?= ?"|GENERATED_BY: _typing\.Final = ")([^"]*)(")/gm,
  field: "the generator version",
  extension: ".py",
};

const PHP_GENERATED_BY: GeneratedVersionForm = {
  line: /^( *public const GENERATED_BY = ')([^']*)(';)$/gm,
  field: "GENERATED_BY",
  extension: ".php",
};

const JAVA_GENERATOR_VERSION: GeneratedVersionForm = {
  line: /^( *public String generatorVersion\(\) \{\n *return ")([^"]*)(";)$/gm,
  field: "generatorVersion()",
  extension: ".java",
};

const PYTEST_UPDATE = "from python/: SEAMPACT_UPDATE_GOLDEN=1 uv run pytest";
const PHPUNIT_UPDATE = "SEAMPACT_UPDATE_GOLDEN=1 vendor/bin/phpunit tests/GoldenTest.php";

export const GOLDEN_TREES: readonly GoldenTree[] = [
  {
    directory: "python/drf/drf_tests/golden",
    form: PYTHON_GENERATED_BY,
    regenerate: `${PYTEST_UPDATE} drf/drf_tests/test_drf_generator.py`,
  },
  {
    directory: "python/fastapi/fastapi_tests/golden",
    form: PYTHON_GENERATED_BY,
    regenerate: `${PYTEST_UPDATE} fastapi/fastapi_tests/test_golden.py`,
  },
  {
    directory: "python/ninja/ninja_tests/golden",
    form: PYTHON_GENERATED_BY,
    regenerate: `${PYTEST_UPDATE} ninja/ninja_tests/test_golden.py`,
  },
  {
    directory: "php/laravel/tests/golden",
    form: PHP_GENERATED_BY,
    regenerate: `from php/laravel/: ${PHPUNIT_UPDATE}`,
  },
  {
    directory: "php/symfony/tests/golden",
    form: PHP_GENERATED_BY,
    regenerate: `from php/symfony/: ${PHPUNIT_UPDATE}`,
  },
  {
    directory: "jvm/seampact-spring-boot/src/test/golden",
    form: JAVA_GENERATOR_VERSION,
    regenerate: "from jvm/: ./gradlew :seampact-spring-boot:test -PupdateGolden",
  },
  {
    directory: "jvm/seampact-spring-boot/src/test/golden-opt-ins",
    form: JAVA_GENERATOR_VERSION,
    regenerate: "from jvm/: ./gradlew :seampact-spring-boot:test -PupdateGolden",
  },
];

export function generatedVersionEdits(root: string, version: string): VersionEdit[] {
  return GOLDEN_TREES.flatMap((tree) => goldenTreeEdits(root, tree, version));
}

// A tree whose files hold no generator version has outgrown the stamp's pattern: refused by name, never skipped.
function goldenTreeEdits(root: string, tree: GoldenTree, version: string): VersionEdit[] {
  const edits = treeFiles(root, tree)
    .map((file) => generatedFileEdit(root, file, tree.form, version))
    .filter((edit) => edit !== undefined);

  if (edits.length === 0)
    throw new ReleaseError(
      `${tree.directory} has no file the stamp can read ${tree.form.field} from (${tree.form.line.source}): ` +
        `update its pattern in scripts/release/generated-versions.ts, or rewrite the tree (${tree.regenerate})`,
    );

  return edits;
}

function treeFiles(root: string, tree: GoldenTree): string[] {
  if (!existsSync(join(root, tree.directory)))
    throw new ReleaseError(
      `${tree.directory} does not exist: the stamp writes the generator version of its golden files`,
    );

  return readdirSync(join(root, tree.directory), { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(tree.form.extension))
    .map((entry) => `${tree.directory}/${entry.replaceAll("\\", "/")}`)
    .sort();
}

/** Every generator version of the file at the version; undefined when the file embeds none. */
function generatedFileEdit(
  root: string,
  file: string,
  form: GeneratedVersionForm,
  version: string,
): VersionEdit | undefined {
  const before = readRepositoryFile(root, file);
  const written = [...before.matchAll(form.line)].map((match) => match[2]);

  if (written.length === 0) return undefined;

  const changes = [...new Set(written.filter((current) => current !== version))].map(
    (current) => `${form.field} is "${current}", not "${version}"`,
  );
  const after = before.replace(
    form.line,
    (_match, prefix: string, _current: string, suffix: string) => `${prefix}${version}${suffix}`,
  );

  return { file, before, after, changes };
}
