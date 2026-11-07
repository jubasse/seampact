import type { Refusal } from "@seampact/codegen-core";
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

export function formatProblem(problem: CliProblem): string {
  const position = problem.position === undefined ? "" : `${problem.position}: `;
  const where = problem.where === undefined ? "" : `${problem.where}: `;
  const docs = problem.docs === undefined ? "" : ` Docs: ${problem.docs}`;

  return `${position}${problem.code}: ${where}${problem.message} Fix: ${problem.fix}${docs}`;
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
