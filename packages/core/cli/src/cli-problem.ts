import type { Refusal } from "@seampact/codegen-core";
import { diagnosticInert } from "@seampact/compiler";
import { type ContractPositions, contractPosition } from "./commands/contract-position.js";

// One refusal or diagnostic the CLI prints on stderr, as
// `<contract file:line>: <code>: <where>: <message> Fix: <fix> Docs: <url>`.
export interface CliProblem {
  code: string;
  message: string;
  fix: string;
  // The config file position and key path, or the target entry and api the problem belongs to.
  where?: string;
  // The contract `file:line` the refused member is declared at.
  position?: string;
  // The URL of the troubleshooting section that holds the code's row.
  docs?: string;
}

// Past this many characters a field of a printed problem is cut: its text can come from a hostile tree.
export const PROBLEM_FIELD_LIMIT = 1000;

const PROBLEM_CUT_MARK = "\u2026";

// A field cut past the limit, then written inert, so authored text never reaches the terminal as an escape sequence.
function printableField(text: string): string {
  const characters = Array.from(text);
  const kept =
    characters.length > PROBLEM_FIELD_LIMIT
      ? `${characters.slice(0, PROBLEM_FIELD_LIMIT).join("")}${PROBLEM_CUT_MARK}`
      : text;

  return diagnosticInert(kept);
}

export function formatProblem(problem: CliProblem): string {
  const position = problem.position === undefined ? "" : `${printableField(problem.position)}: `;
  const where = problem.where === undefined ? "" : `${printableField(problem.where)}: `;
  const docs = problem.docs === undefined ? "" : ` Docs: ${printableField(problem.docs)}`;

  return `${position}${printableField(problem.code)}: ${where}${printableField(problem.message)} Fix: ${printableField(problem.fix)}${docs}`;
}

// The entry and api a problem of `generate` belongs to.
export function entryWhere(entryId: string, api?: string): string {
  return api === undefined ? `entry '${entryId}'` : `entry '${entryId}', api '${api}'`;
}

// A pointer is named when the message holds it whole, not as the start of a longer pointer or number.
function namesPointer(message: string, pointer: string): boolean {
  const escaped = pointer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`${escaped}(?![/\\w])`).test(message);
}

// A target's refusal or warning as the CLI prints it, naming the operation and IR member once: an operation id the
// message quotes, or a member pointer it holds, is not repeated. With the api's positions, the contract `file:line`
// comes first and the IR member stays as a secondary pointer.
export function problemFromRefusal(
  refusal: Refusal,
  where: string,
  positions?: ContractPositions,
): CliProblem {
  const { operation, member, message } = refusal;
  const pointers = [
    operation === undefined || message.includes(`'${operation}'`)
      ? undefined
      : `operation '${operation}'`,
    member === undefined || member === "" || namesPointer(message, member)
      ? undefined
      : `IR member '${member}'`,
  ].filter((pointer) => pointer !== undefined);

  const at = pointers.length === 0 ? "" : ` (${pointers.join(", ")})`;

  const position =
    positions === undefined ? undefined : contractPosition(positions, member, operation);

  return {
    code: refusal.code,
    message: `${message}${at}`,
    fix: refusal.fix,
    where,
    ...(position === undefined ? {} : { position }),
    ...(refusal.docs === undefined ? {} : { docs: refusal.docs }),
  };
}

// A problem of one app of a root run names the app before its own place.
export function inApp(app: string, problem: CliProblem): CliProblem {
  return {
    ...problem,
    where: problem.where === undefined ? `app '${app}'` : `app '${app}', ${problem.where}`,
  };
}

// The entry and api an output belongs to, with its app in a root run.
export function appEntryWhere(app: string | undefined, entryId: string, api?: string): string {
  const where = entryWhere(entryId, api);

  return app === undefined ? where : `app '${app}', ${where}`;
}
