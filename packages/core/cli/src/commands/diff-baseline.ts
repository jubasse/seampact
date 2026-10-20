import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { type ContractIR, createIrValidator, type IrValidationReport } from "@seampact/spec/ir";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { CliProblem } from "../cli-problem.js";
import { errorCode } from "../error-code.js";
import type { Step } from "./step.js";

// The IRs `seampact diff` compares the current contract with: an IR file, or a directory of `<api>.ir.json` files,
// the form `seampact compile --out` writes. A bundle or a git ref is not read yet.

const IR_FILE_SUFFIX = ".ir.json";
const LISTED_PROBLEM_LIMIT = 5;
const AGAINST_FIX =
  "Pass `--against` an IR file, or a directory of `<api>.ir.json` files as `seampact compile --out` writes them.";

let openValidator: ReturnType<typeof createIrValidator> | undefined;

// Compiling the schemas takes a while: one validator serves the process.
function validator(): ReturnType<typeof createIrValidator> {
  openValidator ??= createIrValidator(Ajv2020, "open");

  return openValidator;
}

// The baseline IRs by api name.
export async function readBaseline(path: string): Promise<Step<Map<string, ContractIR>>> {
  const files = await baselineFiles(path);

  if (files.status === "refused") return files;

  const irs = new Map<string, ContractIR>();
  const problems: CliProblem[] = [];

  for (const file of files.value) {
    const read = await readIrFile(file);

    if (read.status === "refused") problems.push(...read.problems);
    else irs.set(read.value.api.id, read.value);
  }

  return problems.length > 0 ? { status: "refused", problems } : { status: "done", value: irs };
}

async function baselineFiles(path: string): Promise<Step<string[]>> {
  const stats = await statIfPresent(path);

  if (stats === undefined) {
    return refused(
      `'${path}' does not exist, and \`--against\` reads a file or a directory (a bundle or a git ref is not read yet).`,
    );
  }

  if (!stats.isDirectory()) return { status: "done", value: [path] };

  const names = (await readdir(path)).filter((name) => name.endsWith(IR_FILE_SUFFIX)).sort();

  if (names.length === 0)
    return refused(`The directory '${path}' holds no \`*${IR_FILE_SUFFIX}\` file.`);

  return { status: "done", value: names.map((name) => join(path, name)) };
}

async function readIrFile(file: string): Promise<Step<ContractIR>> {
  const text = await readFile(file, "utf8");
  let document: unknown;

  try {
    document = JSON.parse(text);
  } catch (error) {
    return refused(
      `'${file}' is not JSON (${error instanceof Error ? error.message : String(error)}).`,
    );
  }

  const report = validator().validate(document);

  if (!isContractIr(document, report)) return refused(invalidMessage(file, report));

  return { status: "done", value: document };
}

// The open schema's verdict is what makes the document a ContractIR.
function isContractIr(document: unknown, report: IrValidationReport): document is ContractIR {
  return report.valid && typeof document === "object" && document !== null;
}

function invalidMessage(file: string, report: IrValidationReport): string {
  const problems = report.problems.map((problem) => `at '${problem.pointer}' ${problem.message}`);
  const listed = problems.slice(0, LISTED_PROBLEM_LIMIT);
  const more = problems.length - listed.length;
  const detail = listed.length === 0 ? "it holds a value the IR does not know" : listed.join("; ");

  return `'${file}' is not valid under the IR JSON Schema: ${detail}${more > 0 ? `; and ${more} more` : ""}.`;
}

function refused(message: string): { status: "refused"; problems: CliProblem[] } {
  return {
    status: "refused",
    problems: [{ code: "diff.against.invalid", message, fix: AGAINST_FIX }],
  };
}

async function statIfPresent(path: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;

    throw error;
  }
}
