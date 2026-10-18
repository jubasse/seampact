// The contract's refusals and their rendering in the api's error format: the exception every check step throws,
// and the reply it becomes. Copied into the generated tree as is.
import type { ContractApi, ContractRoute, ErrorEntry, FormatTemplate } from "./contract-route.js";

/** The longest issues list rendered into a `schemaInvalid` error's params. */
export const MAX_RENDERED_ISSUES = 100;

const INTERNAL_STATUS = 500;
const UNDECLARED_STATUS_ROLE = "undeclaredStatus";
const FALLBACK_INTERNAL_CODE = "api.internal";

/** A reply the boundary writes itself: status, headers in order, and the body bytes. */
export interface ContractReply {
  readonly status: number;
  readonly headers: readonly (readonly [name: string, value: string])[];
  readonly body: Uint8Array;
}

/** A declared error code of the operation, raised by a check step and rendered by the filter. */
export class ContractError extends Error {
  constructor(
    readonly code: string,
    readonly params?: unknown,
    /** Set on an unexpected failure: the cause handed to `onUnexpectedError`. */
    readonly unexpectedCause?: unknown,
  ) {
    super(`seampact contract error ${code}`);
    this.name = "ContractError";
  }
}

/** An unexpected failure: the operation's undeclared-status code, with the cause kept for the hook. */
export function unexpectedError(route: ContractRoute | undefined, cause: unknown): ContractError {
  return new ContractError(
    internalCode(route),
    undefined,
    cause ?? new Error("unexpected failure"),
  );
}

/** The code of the operation's `undeclaredStatus` role, the api-wide 500. */
export function internalCode(route: ContractRoute | undefined): string {
  if (route === undefined) return FALLBACK_INTERNAL_CODE;

  return codeOfRole(route, UNDECLARED_STATUS_ROLE) ?? FALLBACK_INTERNAL_CODE;
}

/** The first code of the operation that answers a role. */
export function codeOfRole(route: ContractRoute, role: string): string | undefined {
  return Object.values(route.errors).find((entry) => entry.roles.includes(role))?.code;
}

/** The first code of the operation with a status. */
export function codeOfStatus(route: ContractRoute, status: number): string | undefined {
  return Object.values(route.errors).find((entry) => entry.status === status)?.code;
}

/** The error rendered in the api's format; a code the operation does not declare renders as its 500. */
export function renderContractReply(
  api: ContractApi,
  route: ContractRoute | undefined,
  error: ContractError,
): ContractReply {
  const declared = route === undefined ? undefined : errorEntry(route, error.code);
  const entry: ErrorEntry = declared ?? {
    code: internalCode(route),
    status: INTERNAL_STATUS,
    nature: "failed",
    roles: [UNDECLARED_STATUS_ROLE],
  };
  const params = declared === undefined ? undefined : error.params;
  const slots: Record<string, unknown> = {
    code: entry.code,
    title: entry.title ?? entry.code,
    status: entry.status,
    nature: entry.nature,
  };
  const rendered = renderTemplate(api.format.body, slots);
  const body =
    api.format.mergeParams && isPlainObject(rendered) && isPlainObject(params)
      ? { ...rendered, ...params }
      : rendered;
  const headers: [string, string][] = [["content-type", api.format.media]];
  const retryHeader = retryHeaderOf(entry, params);

  if (retryHeader !== undefined) headers.push(retryHeader);

  return {
    status: entry.status,
    headers,
    body: new TextEncoder().encode(JSON.stringify(body)),
  };
}

function errorEntry(route: ContractRoute, code: string): ErrorEntry | undefined {
  return Object.hasOwn(route.errors, code) ? route.errors[code] : undefined;
}

function retryHeaderOf(entry: ErrorEntry, params: unknown): [string, string] | undefined {
  const header = entry.retryHeader;

  if (header === undefined || !isPlainObject(params)) return undefined;

  const value = params[header.param];

  if (typeof value !== "number") return undefined;

  const MILLISECONDS_PER_SECOND = 1000;
  const headerValue = header.unit === "s" ? Math.ceil(value / MILLISECONDS_PER_SECOND) : value;

  return [header.name.toLowerCase(), String(headerValue)];
}

// Absent slots are omitted (the format's `absent: omit`).
function renderTemplate(
  template: FormatTemplate,
  slots: Readonly<Record<string, unknown>>,
): unknown {
  switch (template.kind) {
    case "text":
      return template.text;
    case "slot":
      return template.path.reduce<unknown>(
        (value, member) => (isPlainObject(value) ? value[member] : undefined),
        slots[template.slot],
      );
    case "object": {
      const rendered: Record<string, unknown> = {};

      for (const member of template.members) {
        const value = renderTemplate(member.value, slots);

        if (value !== undefined) rendered[member.name] = value;
      }

      return rendered;
    }
  }
}

/** Whether a value is a JSON object (not null, not an array). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
