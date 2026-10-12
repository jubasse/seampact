export interface Problem {
  /** Repository-relative path of the file the problem is in. */
  file: string;
  /** The checklist id the problem is about, when there is one. */
  id?: string;
  message: string;
}

export interface Item {
  id: string;
  fact: string;
  frs: string[];
  scenario: string;
  targets: string[];
  source?: string;
  retired?: string;
}

export interface TestRef {
  raw: string;
  target: string;
  path: string;
  name: string;
}

export interface Proof {
  /** Repository-relative path of the proof file. */
  file: string;
  lane: string;
  id: string;
  fixtures: string[];
  tests: TestRef[];
}

export interface Ids {
  frs: Record<string, string>;
  scenarios: Record<string, string>;
}

export interface Model {
  items: Item[];
  proofs: Proof[];
  ids: Ids;
  /** Checklist ids dropped from `items` by a load problem (already reported). */
  dropped: Set<string>;
}

export const CHECKLIST_FILE = "docs/conformance/checklist.yaml";
export const IDS_FILE = "docs/conformance/ids.yaml";
export const PROOFS_DIR = "docs/conformance/proofs";

export function formatProblem(p: Problem): string {
  return `${p.file}: ${p.id ?? "-"}: ${p.message}`;
}

export function chkNumber(id: string): number {
  return Number(id.slice("CHK-".length));
}
