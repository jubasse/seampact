import type { Refusal } from "@seampact/codegen-core";
import { EXTENSION_NAMES, type ExtensionName, isExtensionName } from "./extension-names.js";

// The emitter options of A40 (ADR 0011): which `x-seampact-*` extensions a document keeps, whether it keeps their
// reasons, whether request bodies point at strict input schemas, and the `servers` it lists.

export const ALL_EXTENSIONS = "all";
export const NO_EXTENSIONS = "none";

export type ExtensionSelection = typeof ALL_EXTENSIONS | typeof NO_EXTENSIONS | readonly ExtensionName[];

export type ReasonsOption = "include" | "omit";

export type InputSchemasOption = "shared" | "strict";

export interface ServerOption {
  url: string;
  description?: string;
}

export interface EmitterOptions {
  extensions: ExtensionSelection;
  reasons: ReasonsOption;
  inputSchemas: InputSchemasOption;
  servers: readonly ServerOption[];
}

export const DEFAULT_EMITTER_OPTIONS: EmitterOptions = {
  extensions: ALL_EXTENSIONS,
  reasons: "include",
  inputSchemas: "shared",
  servers: [],
};

export type ParsedEmitterOptions =
  | { status: "parsed"; options: EmitterOptions }
  | { status: "refused"; refusals: readonly Refusal[] };

const OPTION_KEYS: readonly string[] = ["extensions", "reasons", "inputSchemas", "servers"];
const REASONS_VALUES: readonly ReasonsOption[] = ["include", "omit"];
const INPUT_SCHEMAS_VALUES: readonly InputSchemasOption[] = ["shared", "strict"];

/** Reads the options as the app config writes them; a missing option takes its default. */
export function parseEmitterOptions(raw: unknown): ParsedEmitterOptions {
  if (raw === undefined) return { status: "parsed", options: DEFAULT_EMITTER_OPTIONS };

  if (!isRecord(raw)) {
    return refusedWith(optionRefusal("", "The OpenAPI options must be a mapping.", "Write the options as a mapping."));
  }

  const refusals: Refusal[] = [];

  for (const key of Object.keys(raw)) {
    if (!OPTION_KEYS.includes(key)) {
      refusals.push(
        optionRefusal(`/${key}`, `'${key}' is not an OpenAPI option.`, `Use one of ${OPTION_KEYS.join(", ")}.`),
      );
    }
  }

  const options: EmitterOptions = {
    extensions: parseExtensions(raw.extensions, refusals),
    reasons: parseChoice(raw.reasons, "reasons", REASONS_VALUES, DEFAULT_EMITTER_OPTIONS.reasons, refusals),
    inputSchemas: parseChoice(
      raw.inputSchemas,
      "inputSchemas",
      INPUT_SCHEMAS_VALUES,
      DEFAULT_EMITTER_OPTIONS.inputSchemas,
      refusals,
    ),
    servers: parseServers(raw.servers, refusals),
  };

  return refusals.length > 0 ? refusedWith(...refusals) : { status: "parsed", options };
}

function parseExtensions(raw: unknown, refusals: Refusal[]): ExtensionSelection {
  if (raw === undefined || raw === ALL_EXTENSIONS) return ALL_EXTENSIONS;

  if (raw === NO_EXTENSIONS) return NO_EXTENSIONS;

  if (!Array.isArray(raw)) {
    refusals.push(
      optionRefusal(
        "/extensions",
        "'extensions' must be 'all', 'none' or a list of extension names.",
        "Write 'all', 'none' or a list such as [access, paging].",
      ),
    );

    return ALL_EXTENSIONS;
  }

  const names: ExtensionName[] = [];

  raw.forEach((name: unknown, index) => {
    if (typeof name === "string" && isExtensionName(name)) {
      if (!names.includes(name)) names.push(name);

      return;
    }

    refusals.push(
      optionRefusal(
        `/extensions/${index}`,
        `'${String(name)}' is not an x-seampact extension name.`,
        `Use a name after 'x-seampact-', one of ${EXTENSION_NAMES.join(", ")}.`,
      ),
    );
  });

  return names;
}

function parseChoice<Choice extends string>(
  raw: unknown,
  option: string,
  values: readonly Choice[],
  defaultValue: Choice,
  refusals: Refusal[],
): Choice {
  if (raw === undefined) return defaultValue;

  const choice = values.find((value) => value === raw);

  if (choice !== undefined) return choice;

  refusals.push(
    optionRefusal(
      `/${option}`,
      `'${String(raw)}' is not a value of '${option}'.`,
      `Use one of ${values.join(", ")}.`,
    ),
  );

  return defaultValue;
}

function parseServers(raw: unknown, refusals: Refusal[]): ServerOption[] {
  if (raw === undefined) return [];

  if (!Array.isArray(raw)) {
    refusals.push(optionRefusal("/servers", "'servers' must be a list.", "Write a list of { url, description }."));

    return [];
  }

  const servers: ServerOption[] = [];

  raw.forEach((server: unknown, index) => {
    const parsed = parseServer(server);

    if (parsed !== undefined) {
      servers.push(parsed);

      return;
    }

    refusals.push(
      optionRefusal(
        `/servers/${index}`,
        "A server must be { url, description? } with string values.",
        "Write the server as { url: https://api.example.com }.",
      ),
    );
  });

  return servers;
}

function parseServer(raw: unknown): ServerOption | undefined {
  if (!isRecord(raw) || typeof raw.url !== "string" || raw.url.length === 0) return undefined;

  const keys = Object.keys(raw);

  if (keys.some((key) => key !== "url" && key !== "description")) return undefined;

  if (raw.description === undefined) return { url: raw.url };

  return typeof raw.description === "string" ? { url: raw.url, description: raw.description } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionRefusal(member: string, message: string, fix: string): Refusal {
  return { code: "openapi.options.invalid", message, fix, member };
}

function refusedWith(...refusals: Refusal[]): ParsedEmitterOptions {
  return { status: "refused", refusals };
}
