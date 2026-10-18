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

// A target's refusal as the CLI prints it, keeping the operation and IR member it names.
export function problemFromRefusal(refusal: Refusal, where: string): CliProblem {
  const pointers = [
    refusal.operation === undefined ? undefined : `operation '${refusal.operation}'`,
    refusal.member === undefined ? undefined : `member '${refusal.member}'`,
  ].filter((pointer) => pointer !== undefined);

  const at = pointers.length === 0 ? "" : ` (${pointers.join(", ")})`;

  return { code: refusal.code, message: `${refusal.message}${at}`, fix: refusal.fix, where };
}
