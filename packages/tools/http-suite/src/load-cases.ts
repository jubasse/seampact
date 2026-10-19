// Reads the case files the package ships under `cases/`, one `<id>.json` per case, in file name order.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSuiteCase, type SuiteCase, type SuiteProfile } from "./suite-case.js";

/** The shipped cases, beside `src/` in the repository and `dist/` in the published package. */
export const CASES_DIRECTORY = fileURLToPath(new URL("../cases/", import.meta.url));

const CASE_FILE_SUFFIX = ".json";

/** The cases of a directory (the shipped ones by default) that run in `profile`. */
export function loadSuiteCases(
  profile: SuiteProfile,
  directory: string = CASES_DIRECTORY,
): SuiteCase[] {
  return readCaseFiles(directory).filter((suiteCase) => suiteCase.profiles.includes(profile));
}

function readCaseFiles(directory: string): SuiteCase[] {
  const files = readdirSync(directory).sort();
  const strayFiles = files.filter((file) => !file.endsWith(CASE_FILE_SUFFIX));

  if (strayFiles.length > 0) {
    throw new Error(
      `http-suite: ${directory} holds ${strayFiles.join(", ")}; a cases directory holds only <id>${CASE_FILE_SUFFIX} files`,
    );
  }

  return files.map((file) => {
    const source = join(directory, file);
    const suiteCase = parseSuiteCase(parseJsonFile(source), source);

    if (`${suiteCase.id}${CASE_FILE_SUFFIX}` !== file) {
      throw new Error(
        `http-suite: ${source} holds the case '${suiteCase.id}'; name the file after its id`,
      );
    }

    return suiteCase;
  });
}

function parseJsonFile(source: string): unknown {
  try {
    return JSON.parse(readFileSync(source, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    throw new Error(`http-suite: ${source} is not JSON: ${reason}`);
  }
}
