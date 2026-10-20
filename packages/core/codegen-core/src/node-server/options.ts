import { below } from "../ir-location.js";
import type { Refusal } from "../refusal.js";
import type { ParseOptionsOutcome } from "../target.js";

// The options every Node server target takes (ADR 0016 "Target options"): what a reply outside the contract does,
// whether JSON success replies are validated by the zod output validators, and what happens to an ETag the framework
// adds. A target whose placement compresses its own replies (Fastify) also takes `compression`.
const RESPONSES_MODES = ["strict", "warn"] as const;
const FRAMEWORK_ETAG_MODES = ["strip", "keep"] as const;

export type ResponsesMode = (typeof RESPONSES_MODES)[number];

export type FrameworkEtagMode = (typeof FRAMEWORK_ETAG_MODES)[number];

/** `off` never compresses a reply; otherwise a body of at least `thresholdBytes` is. */
export type CompressionOption = "off" | { thresholdBytes: number };

export interface NodeServerOptions {
  responses: ResponsesMode;
  bodyValidation: boolean;
  frameworkEtag: FrameworkEtagMode;
  compression: CompressionOption;
}

/** The settings the registration may override; the rest of the options are fixed at generation. */
export type ResponseSettingsOptions = Pick<NodeServerOptions, "responses" | "bodyValidation">;

/** The options the generated settings object carries; the registration may override them. */
export function responseSettingsOf(options: NodeServerOptions): ResponseSettingsOptions {
  return { responses: options.responses, bodyValidation: options.bodyValidation };
}

/** What a target's placement lets its entry's `options` name beyond the options every Node server target takes. */
export interface AcceptedNodeServerOptions {
  readonly compression: boolean;
}

const RESPONSES_KEY = "responses";
const BODY_VALIDATION_KEY = "bodyValidation";
const FRAMEWORK_ETAG_KEY = "frameworkEtag";
const COMPRESSION_KEY = "compression";
const THRESHOLD_BYTES_KEY = "thresholdBytes";
const DEFAULT_COMPRESSION_THRESHOLD_BYTES = 1024;

const DEFAULT_NODE_SERVER_OPTIONS: NodeServerOptions = {
  responses: "strict",
  bodyValidation: false,
  frameworkEtag: "strip",
  compression: { thresholdBytes: DEFAULT_COMPRESSION_THRESHOLD_BYTES },
};

/**
 * Accepts `{}`, `responses: strict | warn`, `bodyValidation: true | false`, `frameworkEtag: strip | keep` and, where
 * accepted, `compression: off` or `compression: { thresholdBytes: <whole number> }`; any other key or value is
 * refused.
 */
export function parseNodeServerOptions(
  raw: unknown,
  accepted: AcceptedNodeServerOptions = { compression: false },
): ParseOptionsOutcome<NodeServerOptions> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      status: "refused",
      refusals: [
        {
          code: "options.invalid",
          message: "The target options are not an object.",
          fix: "Write the target's `options` as an object, or leave it out.",
          member: "",
        },
      ],
    };
  }

  const knownKeys = [
    RESPONSES_KEY,
    BODY_VALIDATION_KEY,
    FRAMEWORK_ETAG_KEY,
    ...(accepted.compression ? [COMPRESSION_KEY] : []),
  ];
  const refusals = Object.keys(raw)
    .filter((key) => !knownKeys.includes(key))
    .map((key) => refuseUnknownOption(key, knownKeys));
  const responses = optionValue(raw, RESPONSES_KEY, DEFAULT_NODE_SERVER_OPTIONS.responses);
  const bodyValidation = optionValue(
    raw,
    BODY_VALIDATION_KEY,
    DEFAULT_NODE_SERVER_OPTIONS.bodyValidation,
  );
  const frameworkEtag = optionValue(
    raw,
    FRAMEWORK_ETAG_KEY,
    DEFAULT_NODE_SERVER_OPTIONS.frameworkEtag,
  );
  const compression = optionValue(raw, COMPRESSION_KEY, DEFAULT_NODE_SERVER_OPTIONS.compression);

  if (!isResponsesMode(responses)) {
    refusals.push({
      code: "options.responses.invalid",
      message: `The option 'responses' is ${JSON.stringify(responses)}, not one of ${RESPONSES_MODES.join(", ")}.`,
      fix: "Set 'responses' to 'strict' (the default) or 'warn'.",
      member: `/${RESPONSES_KEY}`,
    });
  }

  if (typeof bodyValidation !== "boolean") {
    refusals.push({
      code: "options.bodyValidation.invalid",
      message: `The option 'bodyValidation' is ${JSON.stringify(bodyValidation)}, not true or false.`,
      fix: "Set 'bodyValidation' to true or false (the default).",
      member: `/${BODY_VALIDATION_KEY}`,
    });
  }

  if (!isFrameworkEtagMode(frameworkEtag)) {
    refusals.push({
      code: "options.frameworkEtag.invalid",
      message: `The option 'frameworkEtag' is ${JSON.stringify(frameworkEtag)}, not one of ${FRAMEWORK_ETAG_MODES.join(", ")}.`,
      fix: "Set 'frameworkEtag' to 'strip' (the default) or 'keep'.",
      member: `/${FRAMEWORK_ETAG_KEY}`,
    });
  }

  if (!isCompressionOption(compression)) {
    refusals.push({
      code: "options.compression.invalid",
      message: `The option 'compression' is ${JSON.stringify(compression)}, not 'off' or { thresholdBytes: <whole number> }.`,
      fix: "Set 'compression' to 'off', to { thresholdBytes: 2048 } for another threshold, or leave it out for 1024 bytes.",
      member: `/${COMPRESSION_KEY}`,
    });
  }

  if (
    refusals.length > 0 ||
    !isResponsesMode(responses) ||
    typeof bodyValidation !== "boolean" ||
    !isFrameworkEtagMode(frameworkEtag) ||
    !isCompressionOption(compression)
  ) {
    return { status: "refused", refusals };
  }

  return {
    status: "parsed",
    options: {
      responses,
      bodyValidation,
      frameworkEtag,
      compression: structuredClone(compression),
    },
  };
}

function optionValue(raw: object, key: string, fallback: unknown): unknown {
  return Object.hasOwn(raw, key) ? Object.getOwnPropertyDescriptor(raw, key)?.value : fallback;
}

function isResponsesMode(value: unknown): value is ResponsesMode {
  return RESPONSES_MODES.some((mode) => mode === value);
}

function isFrameworkEtagMode(value: unknown): value is FrameworkEtagMode {
  return FRAMEWORK_ETAG_MODES.some((mode) => mode === value);
}

function isCompressionOption(value: unknown): value is CompressionOption {
  if (value === "off") return true;

  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const keys = Object.keys(value);
  const thresholdBytes = Object.getOwnPropertyDescriptor(value, THRESHOLD_BYTES_KEY)?.value;

  return (
    keys.length === 1 &&
    keys[0] === THRESHOLD_BYTES_KEY &&
    typeof thresholdBytes === "number" &&
    Number.isInteger(thresholdBytes) &&
    thresholdBytes >= 0
  );
}

function refuseUnknownOption(key: string, knownKeys: readonly string[]): Refusal {
  return {
    code: "options.unknown",
    message: `The option '${key}' is not one this target knows; it takes ${knownKeys.map((known) => `'${known}'`).join(", ")}.`,
    fix: `Remove '${key}' from the target's \`options\`.`,
    member: below({ member: "" }, key).member,
  };
}
