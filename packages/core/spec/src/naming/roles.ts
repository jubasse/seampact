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

const SEGMENT = /^[a-z0-9]+$/;

/**
 * The statuses a `response` name can carry: 200 to 399, success and redirect, which is what a
 * `responses` entry admits (ADR 0002, ADR 0004); the IR stores it as a number.
 */
const MIN_STATUS = 200;
const MAX_STATUS = 399;

/**
 * A name as the IR stores it. A `response` name carries the integer `status` (ADR 0004: the IR
 * uses `status: number` everywhere): the suffix of that role is the word `response` followed by
 * the status (`CreateTaskResponse201`), which the segments alone cannot carry. No other role has
 * a status.
 */
export type Name =
  | { segments: string[]; role: "response"; status: number }
  | { segments: string[]; role: Exclude<Role, "response">; status?: undefined };

/** Suffix words by role, set through the `suffixes` option; the roles of ADR 0007 section 1. */
export type SuffixRole = Exclude<
  Role,
  "schema" | "property" | "variant" | "operation" | "member" | "enumMember"
>;

export type Suffixes = Partial<Record<SuffixRole, string>>;

/** Whether `role` is one of the roles of ADR 0007 section 1 (a role read from an IR can be any string). */
export function isRole(role: unknown): role is Role {
  return typeof role === "string" && (ROLES as readonly string[]).includes(role);
}

/** Throws for a role this version does not know: ADR 0005 open enums, an unknown value is never guessed. */
export function assertRole(role: unknown): asserts role is Role {
  if (!isRole(role)) throw new Error(`unknown naming role ${JSON.stringify(role)}`);
}

/** The roles whose identifier is a type, so that the shadowed type names apply to it. */
export function isTypeRole(role: Role): boolean {
  switch (role) {
    case "schema":
    case "input":
    case "output":
    case "query":
    case "headers":
    case "path":
    case "response":
    case "params":
    case "error":
    case "errors":
    case "property":
    case "item":
    case "value":
    case "variant":
    case "endpoints":
      return true;
    case "operation":
    case "member":
    case "enumMember":
      return false;
    default: {
      const unknown: never = role;

      throw new Error(`unknown naming role ${JSON.stringify(unknown)}`);
    }
  }
}

// The default suffix word of each role (ADR 0007 section 1 table); roles without one give undefined.
function defaultSuffix(role: Role): string | undefined {
  switch (role) {
    case "input":
    case "output":
    case "query":
    case "headers":
    case "path":
    case "response":
    case "params":
    case "error":
    case "errors":
    case "item":
    case "value":
    case "endpoints":
      return role;
    case "schema":
    case "property":
    case "variant":
    case "operation":
    case "member":
    case "enumMember":
      return undefined;
    default: {
      const unknown: never = role;

      throw new Error(`unknown naming role ${JSON.stringify(unknown)}`);
    }
  }
}

function assertStatus(status: unknown): asserts status is number {
  if (
    !Number.isInteger(status) ||
    (status as number) < MIN_STATUS ||
    (status as number) > MAX_STATUS
  ) {
    throw new Error(
      `a response status is an integer from ${MIN_STATUS} to ${MAX_STATUS}, got ${String(status)}`,
    );
  }
}

/** Throws unless `segments` are `[a-z0-9]+` strings: every identifier is built from them. */
export function assertSegments(segments: readonly string[]): void {
  if (!Array.isArray(segments)) {
    throw new Error(`naming segments are an array, got ${JSON.stringify(segments)}`);
  }

  for (const segment of segments) {
    if (typeof segment !== "string" || !SEGMENT.test(segment)) {
      throw new Error(`a naming segment is [a-z0-9]+, got ${JSON.stringify(segment)}`);
    }
  }
}

/**
 * Throws unless `name` is well formed: a known role, valid segments, and a status exactly when
 * the role is `response`. Names built by hand or read from an IR are checked, never trusted.
 */
export function assertName(name: Name): void {
  const role: unknown = name.role;
  const status: unknown = name.status;

  assertRole(role);
  assertSegments(name.segments);

  if (role === "response") assertStatus(status);
  else if (status !== undefined) {
    throw new Error(`role ${role} has no status, got ${String(status)}`);
  }
}

/**
 * The suffix words appended after the segments of `name`, in order. `suffixes` replaces the word
 * of a role (a NestJS habit: `input: "dto"`); the status of a `response` still follows it.
 */
export function suffixWords(name: Name, suffixes?: Suffixes): string[] {
  assertName(name);
  const base = defaultSuffix(name.role);

  if (base === undefined) return [];
  let word = base;

  if (suffixes !== undefined && Object.hasOwn(suffixes, name.role)) {
    word = suffixes[name.role as SuffixRole] as string;

    if (typeof word !== "string" || !SEGMENT.test(word)) {
      throw new Error(`the suffix of role ${name.role} is [a-z0-9]+, got ${JSON.stringify(word)}`);
    }
  }

  if (name.role === "response") return [word, String(name.status)];

  return [word];
}

/**
 * The derived name of an inline schema or a generated type (ADR 0007 section 3): the segments of
 * the owner, the role selecting the suffix word. For `property` and `variant`, `owner` already
 * holds the parent's whole name followed by the property's or the tag's segments: the parent's
 * segments, then its default suffix words when it is derived (`[roles, params, scope]`, ADR 0007
 * amendment 2026-10-12, item 10). `status` is required for a `response` and rejected for every
 * other role. Throws on an unknown role or a malformed segment or status.
 */
export function deriveName(owner: readonly string[], role: "response", status: number): Name;
export function deriveName(
  owner: readonly string[],
  role: Exclude<Role, "response">,
  status?: undefined,
): Name;
export function deriveName(owner: readonly string[], role: Role, status?: number): Name;
export function deriveName(owner: readonly string[], role: Role, status?: number): Name {
  assertRole(role);
  assertSegments(owner);
  // The `status` key exists on a response name only.
  const name = (
    role === "response"
      ? { segments: [...owner], role, status: status as number }
      : { segments: [...owner], role, ...(status === undefined ? {} : { status }) }
  ) as Name;

  assertName(name);

  return name;
}
