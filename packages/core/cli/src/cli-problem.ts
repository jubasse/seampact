import type { Refusal } from "@seampact/codegen-core";

// One refusal or diagnostic the CLI prints on stderr, as `<code>: <where>: <message> Fix: <fix>`.
export interface CliProblem {
  code: string;
  message: string;
  fix: string;
  // The config file position and key path, or the target entry and api the problem belongs to.
  where?: string;
}

export function formatProblem(problem: CliProblem): string {
  const where = problem.where === undefined ? "" : `${problem.where}: `;

  return `${problem.code}: ${where}${problem.message} Fix: ${problem.fix}`;
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
// message quotes, or a member pointer it holds, is not repeated.
export function problemFromRefusal(refusal: Refusal, where: string): CliProblem {
  const { operation, member, message } = refusal;
  const pointers = [
    operation === undefined || message.includes(`'${operation}'`)
      ? undefined
      : `operation '${operation}'`,
    member === undefined || member === "" || namesPointer(message, member)
      ? undefined
      : `member '${member}'`,
  ].filter((pointer) => pointer !== undefined);

  const at = pointers.length === 0 ? "" : ` (${pointers.join(", ")})`;

  return { code: refusal.code, message: `${message}${at}`, fix: refusal.fix, where };
}
