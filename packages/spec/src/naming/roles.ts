// ADR 0007 section 1: names in the IR are word segments plus a role.

export const ROLES = [
  "schema",
  "input",
  "output",
  "query",
  "headers",
  "path",
  "response",
  "params",
  "error",
  "errors",
  "property",
  "item",
  "value",
  "variant",
  "endpoints",
  "operation",
  "member",
  "enumMember",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * A name as the IR stores it. `status` is set for the `response` role only: the suffix of that
 * role is the word `response` followed by the status (`CreateTaskResponse201`), which the
 * segments alone cannot carry.
 */
export interface Name {
  segments: string[];
  role: Role;
  status?: string;
}

// The suffix word of each role (ADR 0007 section 1 table); roles absent here have none.
const SUFFIX_WORDS: Partial<Record<Role, string>> = {
  input: "input",
  output: "output",
  query: "query",
  headers: "headers",
  path: "path",
  response: "response",
  params: "params",
  error: "error",
  errors: "errors",
  item: "item",
  value: "value",
  endpoints: "endpoints",
};

/** The suffix words appended after the segments of `name`, in order. */
export function suffixWords(name: Name): string[] {
  const word = SUFFIX_WORDS[name.role];
  if (word === undefined) return [];
  if (name.role === "response" && name.status !== undefined) return [word, name.status];
  return [word];
}

/**
 * The derived name of an inline schema or a generated type (ADR 0007 section 3): the segments of
 * the owner, the role selecting the suffix word. For `property` and `variant`, `owner` already
 * holds the parent's segments followed by the property's or the tag's. `status` is the status of
 * a `response`.
 */
export function deriveName(owner: readonly string[], role: Role, status?: string): Name {
  const name: Name = { segments: [...owner], role };
  if (role === "response" && status !== undefined) name.status = status;
  return name;
}
