import type { IrWriter } from "@seampact/spec/ir";
import { type PassContext, pipelineCopy, pipelineParseDuration } from "../../../pipeline/seam.js";
import {
  type AccessIdentityRawObject,
  accessIdentityEntries,
  accessIdentityMember,
  accessIdentityObject,
  accessIdentityPointer,
  accessIdentityString,
  accessIdentityStrings,
} from "./read.js";
import type { AccessIdentityReporter } from "./report.js";
import { accessIdentityValueSource } from "./source.js";

// The `schemes` catalogue (FR-27, ADR 0002 section 9, ADR 0013) in the tagged forms of ADR 0004 section 13, with
// the checks the authoring schema cannot state: the members each kind needs, a cookie's `csrf` reference, and a
// signature scheme's keys against its `verify` form, its templates and its tolerance.

const SIGNATURE_ENCODINGS: readonly IrWriter.SignatureEncoding[] = ["hex", "base64"];

const isSignatureEncoding = (text: string): text is IrWriter.SignatureEncoding =>
  SIGNATURE_ENCODINGS.some((encoding) => encoding === text);

// ADR 0013: `hmac-sha256` is the one v1 MAC. The IR enum is open and not must-act, so a weaker value written here
// would reach every target unchecked.
const SIGNATURE_ALGORITHMS: readonly string[] = ["hmac-sha256"];

// ADR 0013: a format is comma-separated `name={placeholder}` pairs, or a literal prefix and `{sig}`.
const FORMAT_PAIR = /^[^=,{}]+=\{(sig|ts)\}$/;
const FORMAT_PREFIX = /^[^{}]*\{sig\}$/;
const PLACEHOLDER = /\{([A-Za-z]+)\}/g;

const TEMPLATE_MEMBERS = ["format", "algorithm", "payload", "encoding"] as const;

interface SchemeEntry {
  id: string;
  pointer: string;
  raw: AccessIdentityRawObject;
  origin: IrWriter.Origin;
  reporter: AccessIdentityReporter;
}

const placeholdersOf = (template: string): string[] =>
  [...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");

const countOf = (items: readonly string[], item: string): number =>
  items.filter((candidate) => candidate === item).length;

/** Each written scheme's `kind`, also for a scheme left out of the catalogue for an error. */
export const accessIdentitySchemeKinds = (context: PassContext): Map<string, string | undefined> =>
  new Map(
    accessIdentityEntries(context.raw.merged, "schemes").map(([id, raw]) => [
      id,
      accessIdentityString(raw, "kind"),
    ]),
  );

/** The schemes of the api, by id, in written order; a scheme with an error is left out. */
export function accessIdentitySchemes(
  context: PassContext,
  kinds: ReadonlyMap<string, string | undefined>,
  reporter: AccessIdentityReporter,
): Map<string, IrWriter.KnownScheme> {
  const schemes = new Map<string, IrWriter.KnownScheme>();

  for (const [id, raw] of accessIdentityEntries(context.raw.merged, "schemes")) {
    const pointer = accessIdentityPointer("", "schemes", id);
    const origin = context.origin(pointer);
    if (origin === undefined) throw new Error(`the scheme at ${pointer} has no origin`);

    const before = reporter.errors;
    const scheme = schemeOf({ id, pointer, raw, origin, reporter }, kinds);
    if (scheme !== undefined && reporter.errors === before) schemes.set(id, scheme);
  }

  return schemes;
}

function schemeOf(
  entry: SchemeEntry,
  kinds: ReadonlyMap<string, string | undefined>,
): IrWriter.KnownScheme | undefined {
  const { id, origin, raw } = entry;
  switch (accessIdentityString(raw, "kind")) {
    case "cookie":
      return cookieScheme(entry, kinds);
    case "header":
    case "query": {
      const name = requiredName(entry);
      if (name === undefined) return undefined;
      const kind = accessIdentityString(raw, "kind") === "header" ? "header" : "query";
      return { id, kind, name, origin } satisfies IrWriter.KnownScheme;
    }
    case "bearer":
      return bearerScheme(entry);
    case "basic":
      return { id, kind: "basic", origin } satisfies IrWriter.KnownScheme;
    case "signature":
      return signatureScheme(entry);
    default:
      // The authoring schema requires one of the six kinds.
      throw new Error(`the scheme at ${entry.pointer} has no known kind`);
  }
}

// The cookie, header, query or signature header name, which the authoring schema leaves optional.
function requiredName(entry: SchemeEntry): string | undefined {
  const name = accessIdentityString(entry.raw, "name");
  if (name !== undefined) return name;

  const kind = accessIdentityString(entry.raw, "kind") ?? "scheme";
  entry.reporter.error({
    rule: "scheme-member",
    message: `${kind} scheme '${entry.id}' has no 'name'`,
    fix: `Set 'name' to the ${kind === "signature" ? "header carrying the signature" : `${kind} name`}.`,
    pointer: entry.pointer,
  });
  return undefined;
}

function cookieScheme(
  entry: SchemeEntry,
  kinds: ReadonlyMap<string, string | undefined>,
): IrWriter.KnownScheme | undefined {
  const name = requiredName(entry);
  const csrf = accessIdentityString(entry.raw, "csrf");
  if (csrf !== undefined && kinds.get(csrf) !== "header") {
    const known = kinds.has(csrf);
    entry.reporter.error({
      rule: known ? "scheme-kind" : "scheme-reference",
      message: known
        ? `cookie scheme '${entry.id}' names '${csrf}' as its csrf scheme, a ${kinds.get(csrf)} scheme`
        : `cookie scheme '${entry.id}' names '${csrf}' as its csrf scheme, which is no declared scheme`,
      fix: "Name a header scheme, the header a cookie write must also present.",
      pointer: accessIdentityPointer(entry.pointer, "csrf"),
    });
    return undefined;
  }

  if (name === undefined) return undefined;
  return {
    id: entry.id,
    kind: "cookie",
    name,
    ...(csrf === undefined ? {} : { csrf }),
    origin: entry.origin,
  } satisfies IrWriter.KnownScheme;
}

function bearerScheme(entry: SchemeEntry): IrWriter.KnownScheme {
  const format = accessIdentityString(entry.raw, "bearerFormat");
  const oauth2 = accessIdentityObject(entry.raw, "oauth2");
  const openIdConnectUrl = accessIdentityString(entry.raw, "openIdConnect");
  // The authoring schema refuses `oauth2` beside `openIdConnect`.
  const bearer: IrWriter.BearerFacts = {
    ...(format === undefined ? {} : { format }),
    ...(oauth2 === undefined
      ? {}
      : { oauth2: { flows: pipelineCopy(accessIdentityMember(oauth2, "flows")) } }),
    ...(openIdConnectUrl === undefined ? {} : { openIdConnectUrl }),
  };

  return {
    id: entry.id,
    kind: "bearer",
    ...(Object.keys(bearer).length === 0 ? {} : { bearer }),
    origin: entry.origin,
  } satisfies IrWriter.KnownScheme;
}

function signatureScheme(entry: SchemeEntry): IrWriter.KnownScheme | undefined {
  const name = requiredName(entry);
  const verify =
    accessIdentityString(entry.raw, "verify") === "application"
      ? applicationSignature(entry)
      : templateSignature(entry);

  if (name === undefined || verify === undefined) return undefined;
  return {
    id: entry.id,
    kind: "signature",
    name,
    signature: verify,
    origin: entry.origin,
  } satisfies IrWriter.KnownScheme;
}

// The authoring schema refuses the template members beside `verify: application`.
function applicationSignature(entry: SchemeEntry): IrWriter.KnownSignatureVerify | undefined {
  const key = signatureKey(entry);
  if (key === "refused") return undefined;

  return {
    verify: "application",
    headers: accessIdentityStrings(entry.raw, "headers") ?? [],
    ...(key === undefined ? {} : { key }),
  } satisfies IrWriter.KnownSignatureVerify;
}

function templateSignature(entry: SchemeEntry): IrWriter.KnownSignatureVerify | undefined {
  const { raw, reporter } = entry;
  const before = reporter.errors;

  const missing = TEMPLATE_MEMBERS.filter(
    (member) => accessIdentityString(raw, member) === undefined,
  );
  if (missing.length > 0)
    reporter.error({
      rule: "signature-verify",
      message: `signature scheme '${entry.id}' verifies by template and has no ${missing.map((m) => `'${m}'`).join(", ")}`,
      fix: "Declare format, algorithm, payload and encoding (ADR 0013), or set 'verify: application' to verify in the authenticate hook.",
      pointer: entry.pointer,
    });

  if (accessIdentityMember(raw, "headers") !== undefined)
    reporter.error({
      rule: "signature-verify",
      message: `signature scheme '${entry.id}' verifies by template and lists 'headers'`,
      fix: "Remove 'headers', which only 'verify: application' hands to the authenticate hook, or set 'verify: application'.",
      pointer: accessIdentityPointer(entry.pointer, "headers"),
    });

  const format = accessIdentityString(raw, "format") ?? "";
  const payload = accessIdentityString(raw, "payload") ?? "";
  const algorithm = accessIdentityString(raw, "algorithm") ?? "";
  const encoding = accessIdentityString(raw, "encoding") ?? "";
  let toleranceMs: number | undefined;
  if (missing.length === 0) {
    checkFormat(entry, format);
    checkPayload(entry, format, payload);
    checkAlgorithm(entry, algorithm);
    checkEncoding(entry, encoding);
    toleranceMs = tolerance(entry, format, payload);
  }

  const key = signatureKey(entry);
  if (key === undefined)
    reporter.error({
      rule: "signature-key",
      message: `signature scheme '${entry.id}' verifies by template and has no 'key'`,
      fix: "Name the key id the secret lookup receives: 'key: { value: <id> }' or 'key: { from: <path, query or header source> }'.",
      pointer: entry.pointer,
    });

  if (reporter.errors > before || key === undefined || key === "refused") return undefined;
  if (!isSignatureEncoding(encoding)) return undefined;
  return {
    verify: "template",
    format,
    algorithm,
    payload,
    encoding,
    ...(toleranceMs === undefined ? {} : { toleranceMs }),
    key,
  } satisfies IrWriter.KnownSignatureVerify;
}

function checkFormat(entry: SchemeEntry, format: string): void {
  const placeholders = placeholdersOf(format);
  const pointer = accessIdentityPointer(entry.pointer, "format");
  const unknown = placeholders.filter((name) => name !== "sig" && name !== "ts");
  const fits =
    countOf(placeholders, "sig") === 1 &&
    countOf(placeholders, "ts") <= 1 &&
    unknown.length === 0 &&
    (format.split(",").every((item) => FORMAT_PAIR.test(item)) || FORMAT_PREFIX.test(format));
  if (fits) return;

  entry.reporter.error({
    rule: "signature-template",
    message: `the format '${format}' of signature scheme '${entry.id}' is neither comma-separated 'name={placeholder}' pairs nor a literal prefix and '{sig}', with '{sig}' once and '{ts}' at most once`,
    fix: "Write the header layout as 't={ts},v1={sig}' pairs or as a prefix and '{sig}', such as 'sha256={sig}' (ADR 0013).",
    pointer,
  });
}

function checkPayload(entry: SchemeEntry, format: string, payload: string): void {
  const placeholders = placeholdersOf(payload);
  const pointer = accessIdentityPointer(entry.pointer, "payload");
  const unknown = placeholders.filter((name) => name !== "rawBody" && name !== "ts");
  if (
    countOf(placeholders, "rawBody") !== 1 ||
    countOf(placeholders, "ts") > 1 ||
    unknown.length > 0
  )
    entry.reporter.error({
      rule: "signature-template",
      message: `the payload '${payload}' of signature scheme '${entry.id}' must hold '{rawBody}' once and '{ts}' at most once, and no other placeholder`,
      fix: "Write the signed bytes from '{rawBody}', '{ts}' and literal text, such as '{ts}.{rawBody}'.",
      pointer,
    });

  if (placeholders.includes("ts") && !placeholdersOf(format).includes("ts"))
    entry.reporter.error({
      rule: "signature-template",
      message: `the payload of signature scheme '${entry.id}' signs '{ts}', which its format does not read`,
      fix: "Add the '{ts}' pair to the format, or remove '{ts}' from the payload.",
      pointer,
    });
}

function checkAlgorithm(entry: SchemeEntry, algorithm: string): void {
  if (SIGNATURE_ALGORITHMS.includes(algorithm)) return;
  entry.reporter.error({
    rule: "signature-template",
    message: `signature scheme '${entry.id}' has algorithm '${algorithm}', which is not ${SIGNATURE_ALGORITHMS.join(" or ")}`,
    fix: "Set 'algorithm' to 'hmac-sha256', or set 'verify: application' to verify any other MAC in the authenticate hook.",
    pointer: accessIdentityPointer(entry.pointer, "algorithm"),
  });
}

function checkEncoding(entry: SchemeEntry, encoding: string): void {
  if (isSignatureEncoding(encoding)) return;
  entry.reporter.error({
    rule: "signature-template",
    message: `signature scheme '${entry.id}' has encoding '${encoding}', which is neither hex nor base64`,
    fix: "Set 'encoding' to 'hex' or 'base64'.",
    pointer: accessIdentityPointer(entry.pointer, "encoding"),
  });
}

// ADR 0002 section 9: `tolerance` is required when `{ts}` is used and refused otherwise.
function tolerance(entry: SchemeEntry, format: string, payload: string): number | undefined {
  const written = accessIdentityString(entry.raw, "tolerance");
  const usesTimestamp = [...placeholdersOf(format), ...placeholdersOf(payload)].includes("ts");

  if (usesTimestamp && written === undefined) {
    entry.reporter.error({
      rule: "signature-tolerance",
      message: `signature scheme '${entry.id}' reads '{ts}' and has no 'tolerance'`,
      fix: "Set 'tolerance' to the largest distance accepted between the signed timestamp and now, such as '5m'.",
      pointer: entry.pointer,
    });
    return undefined;
  }

  if (written === undefined) return undefined;
  const pointer = accessIdentityPointer(entry.pointer, "tolerance");
  if (!usesTimestamp) {
    entry.reporter.error({
      rule: "signature-tolerance",
      message: `signature scheme '${entry.id}' has a 'tolerance' and reads no '{ts}'`,
      fix: "Remove 'tolerance', or add '{ts}' to the format and the payload.",
      pointer,
    });
    return undefined;
  }

  const toleranceMs = pipelineParseDuration(written);
  if (toleranceMs === undefined)
    entry.reporter.error({
      rule: "signature-tolerance",
      message: `the tolerance '${written}' of signature scheme '${entry.id}' is too large`,
      fix: "Write a tolerance of minutes, such as '5m'.",
      pointer,
    });
  return toleranceMs;
}

// The scheme's key: absent, refused (an empty mapping), or its tagged form.
function signatureKey(entry: SchemeEntry): IrWriter.KnownSchemeKey | "refused" | undefined {
  const key = accessIdentityObject(entry.raw, "key");
  if (key === undefined) return undefined;

  const value = accessIdentityString(key, "value");
  if (value !== undefined) return { kind: "value", value } satisfies IrWriter.KnownSchemeKey;

  const from = accessIdentityString(key, "from");
  if (from !== undefined)
    return {
      kind: "from",
      from: accessIdentityValueSource(from),
    } satisfies IrWriter.KnownSchemeKey;

  entry.reporter.error({
    rule: "signature-key",
    message: `the key of signature scheme '${entry.id}' names neither a value nor a source`,
    fix: "Write 'key: { value: <id> }' or 'key: { from: <path, query or header source> }'.",
    pointer: accessIdentityPointer(entry.pointer, "key"),
  });
  return "refused";
}
