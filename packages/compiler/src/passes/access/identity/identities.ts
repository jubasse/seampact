import type { IrWriter } from "@seampact/spec/ir";
import type { PassContextOf, PassReadonly } from "../../../pipeline/seam.js";
import { type AccessIdentityHeader, accessIdentityActorSurfaceRefusal } from "./headers.js";
import { accessIdentityPrincipal, accessIdentityPrincipalHasField } from "./principal.js";
import {
  type AccessIdentityRawObject,
  accessIdentityBoolean,
  accessIdentityEntries,
  accessIdentityMember,
  accessIdentityObject,
  accessIdentityPointer,
  accessIdentityString,
  accessIdentityStrings,
} from "./read.js";
import type { AccessIdentityReporter } from "./report.js";
import { accessIdentitySchemaUse } from "./schema-use.js";
import { accessIdentityValueSource } from "./source.js";

// The `identities` catalogue (ADR 0002 section 9, ADR 0013): credential identities with their read, write and
// optional-read schemes, signed identities with their one signature scheme and unknown-key policy, each with its
// principal, errors as written, and its uses of the headers catalogue checked against their declarations.

type Context = PassContextOf<"access.identity">;

type Schemas = PassReadonly<Record<string, IrWriter.Schema>>;

const CREDENTIAL_LISTS = ["read", "write", "optionalRead"] as const;

const HEADER_USE_FOR: readonly IrWriter.HeaderUseFor[] = ["all", "reads", "writes"];

// ADR 0002 section 9 gives no default for `for`; `all` applies the header to every operation of the identity.
const DEFAULT_HEADER_USE_FOR: IrWriter.HeaderUseFor = "all";

const isHeaderUseFor = (text: string | undefined): text is IrWriter.HeaderUseFor =>
  HEADER_USE_FOR.some((value) => value === text);

/** What the identities read besides the raw tree: the scheme kinds as written and the built header catalogue. */
export interface AccessIdentityCatalogues {
  /** Each written scheme's `kind`, also for a scheme left out of the catalogue for an error. */
  schemeKinds: ReadonlyMap<string, string | undefined>;
  headers: ReadonlyMap<string, AccessIdentityHeader>;
  schemas: Schemas;
}

interface IdentityEntry {
  id: string;
  pointer: string;
  raw: AccessIdentityRawObject;
  context: Context;
  catalogues: AccessIdentityCatalogues;
  reporter: AccessIdentityReporter;
}

/** The identities of the api, by id, in written order; an identity with an error is left out. */
export function accessIdentityIdentities(
  context: Context,
  catalogues: AccessIdentityCatalogues,
  reporter: AccessIdentityReporter,
): Map<string, IrWriter.KnownIdentity> {
  const identities = new Map<string, IrWriter.KnownIdentity>();

  for (const [id, raw] of accessIdentityEntries(context.raw.merged, "identities")) {
    const pointer = accessIdentityPointer("", "identities", id);
    const before = reporter.errors;
    const identity = identityOf({ id, pointer, raw, context, catalogues, reporter });
    if (identity !== undefined && reporter.errors === before) identities.set(id, identity);
  }

  return identities;
}

function identityOf(entry: IdentityEntry): IrWriter.KnownIdentity | undefined {
  const { id, pointer, raw, context, reporter } = entry;
  const origin = context.origin(pointer);
  if (origin === undefined) throw new Error(`the identity at ${pointer} has no origin`);

  const signed = accessIdentityString(raw, "kind") === "signed";
  const kindMembers = signed ? signedMembers(entry) : credentialMembers(entry);

  const writtenPrincipal = accessIdentityMember(raw, "principal");
  if (writtenPrincipal === undefined) {
    reporter.error({
      rule: "identity-member",
      message: `identity '${id}' has no 'principal'`,
      fix: "Name the principal schema the authenticate hook answers, or 'variants: { <name>: <schema> }'.",
      pointer,
    });
    return undefined;
  }

  const principal = accessIdentityPrincipal(
    id,
    pointer,
    writtenPrincipal,
    context,
    entry.catalogues.schemas,
    reporter,
  );
  if (principal.status !== "resolved") return undefined;

  const headers = headerUses(entry, principal.principal);
  if (kindMembers === undefined || headers === undefined) return undefined;

  return {
    id,
    ...kindMembers,
    principal: principal.principal,
    errors: accessIdentityStrings(raw, "errors") ?? [],
    headers,
    docs: docsOf(raw),
    extensions: {},
    origin,
  } satisfies IrWriter.KnownIdentity;
}

function docsOf(raw: AccessIdentityRawObject): IrWriter.Docs {
  const summary = accessIdentityString(raw, "summary");
  const description = accessIdentityString(raw, "description");
  return {
    ...(summary === undefined ? {} : { summary }),
    ...(description === undefined ? {} : { description }),
  };
}

type CredentialMembers = Pick<IrWriter.CredentialIdentity, "kind" | "schemes">;

type SignedMembers = Pick<IrWriter.SignedIdentity, "kind" | "signed" | "unknownKeys">;

function credentialMembers(entry: IdentityEntry): CredentialMembers | undefined {
  const { id, pointer, raw, reporter } = entry;
  const schemes = accessIdentityObject(raw, "schemes");
  if (schemes === undefined) {
    reporter.error({
      rule: "identity-member",
      message: `credential identity '${id}' has no 'schemes'`,
      fix: "List the schemes accepted on reads and on writes, as 'schemes: { read: [...], write: [...] }', or set 'kind: signed' and name its 'scheme'.",
      pointer,
    });
    return undefined;
  }

  const before = reporter.errors;
  const lists = CREDENTIAL_LISTS.map((list) => {
    const names = accessIdentityStrings(schemes, list) ?? [];
    names.forEach((name, index) => {
      checkCredentialScheme(
        entry,
        name,
        accessIdentityPointer(pointer, "schemes", list, `${index}`),
      );
    });
    // ADR 0004 section 9: an identity's scheme lists are sorted.
    return [...names].sort();
  });
  if (reporter.errors > before) return undefined;

  const [read = [], write = [], optionalRead = []] = lists;
  return { kind: "credential", schemes: { read, write, optionalRead } };
}

function checkCredentialScheme(entry: IdentityEntry, name: string, pointer: string): void {
  const kinds = entry.catalogues.schemeKinds;
  if (!kinds.has(name)) {
    entry.reporter.error({
      rule: "scheme-reference",
      message: `identity '${entry.id}' names scheme '${name}', which is not declared`,
      fix: "Declare the scheme under 'schemes', or name a declared one.",
      pointer,
    });
    return;
  }

  if (kinds.get(name) !== "signature") return;
  entry.reporter.error({
    rule: "scheme-kind",
    message: `credential identity '${entry.id}' names signature scheme '${name}'`,
    fix: "Declare a signed identity for the signature scheme: 'kind: signed' and 'scheme: <name>' (ADR 0013).",
    pointer,
  });
}

function signedMembers(entry: IdentityEntry): SignedMembers | undefined {
  const { id, pointer, raw, reporter } = entry;
  const scheme = accessIdentityString(raw, "scheme");
  const kinds = entry.catalogues.schemeKinds;
  if (scheme === undefined) {
    reporter.error({
      rule: "identity-member",
      message: `signed identity '${id}' has no 'scheme'`,
      fix: "Name the one signature scheme its requests are signed with: 'scheme: <name>'.",
      pointer,
    });
    return undefined;
  }

  const schemePointer = accessIdentityPointer(pointer, "scheme");
  if (!kinds.has(scheme) || kinds.get(scheme) !== "signature") {
    const declared = kinds.has(scheme);
    reporter.error({
      rule: declared ? "scheme-kind" : "scheme-reference",
      message: declared
        ? `signed identity '${id}' names ${kinds.get(scheme)} scheme '${scheme}'; a signed identity takes a signature scheme`
        : `signed identity '${id}' names scheme '${scheme}', which is not declared`,
      fix: "Name a scheme of 'kind: signature' (ADR 0013), or make the identity a credential one.",
      pointer: schemePointer,
    });
    return undefined;
  }

  const unknownKeys = keysPolicy(raw);
  return {
    kind: "signed",
    signed: scheme,
    ...(unknownKeys === undefined ? {} : { unknownKeys }),
  };
}

// The authoring schema writes exactly one of `ignore` and `keep`, each with its reason.
function keysPolicy(raw: AccessIdentityRawObject): IrWriter.KnownKeysPolicy | undefined {
  const written = accessIdentityObject(raw, "unknownKeys");
  if (written === undefined) return undefined;

  const ignore = accessIdentityString(written, "ignore");
  if (ignore !== undefined) return { policy: "ignore", reason: ignore };
  const keep = accessIdentityString(written, "keep");
  if (keep !== undefined) return { policy: "keep", reason: keep };
  throw new Error("an identity's unknownKeys holds neither 'ignore' nor 'keep'");
}

function headerUses(
  entry: IdentityEntry,
  principal: IrWriter.KnownPrincipal,
): IrWriter.IdentityHeaderUse[] | undefined {
  const before = entry.reporter.errors;
  const uses: IrWriter.IdentityHeaderUse[] = [];

  for (const [header, raw] of accessIdentityEntries(entry.raw, "headers")) {
    const pointer = accessIdentityPointer(entry.pointer, "headers", header);
    const use = headerUse(entry, principal, header, pointer, raw);
    if (use !== undefined) uses.push(use);
  }

  return entry.reporter.errors > before ? undefined : uses;
}

function headerUse(
  entry: IdentityEntry,
  principal: IrWriter.KnownPrincipal,
  header: string,
  pointer: string,
  raw: AccessIdentityRawObject,
): IrWriter.IdentityHeaderUse | undefined {
  const { context, reporter } = entry;
  const declared = entry.catalogues.headers.get(header);
  if (declared === undefined) {
    // A declaration with an error of its own is left out of the catalogue and already reported.
    const written = accessIdentityObject(context.raw.merged, "headers");
    if (written === undefined || !Object.hasOwn(written, header))
      reporter.error({
        rule: "header-use",
        message: `identity '${entry.id}' uses header '${header}', which is not declared`,
        fix: "Declare the header under 'headers' with its name and semantic, or use a declared one.",
        pointer,
      });
    return undefined;
  }

  const origin = context.origin(pointer);
  if (origin === undefined) throw new Error(`the header use at ${pointer} has no origin`);

  const before = reporter.errors;
  const schema = useSchema(entry, declared, header, pointer, raw);
  const tokenMembers = versionTokenMembers(entry, principal, declared, header, pointer, raw);
  if (reporter.errors > before || tokenMembers === undefined) return undefined;

  const useFor = accessIdentityString(raw, "for");
  return {
    header,
    for: isHeaderUseFor(useFor) ? useFor : DEFAULT_HEADER_USE_FOR,
    required: accessIdentityBoolean(raw, "required") ?? false,
    ...(schema === undefined ? {} : { schema }),
    ...tokenMembers,
    origin,
  };
}

// ADR 0002 section 9: a use sets `schema` only when the declaration has none; an actorSurface needs one.
function useSchema(
  entry: IdentityEntry,
  declared: AccessIdentityHeader,
  header: string,
  pointer: string,
  raw: AccessIdentityRawObject,
): IrWriter.TypeUse | undefined {
  const { reporter } = entry;
  const schemaPointer = accessIdentityPointer(pointer, "schema");
  const written = accessIdentityMember(raw, "schema") !== undefined;

  if (written && declared.schemaWritten) {
    reporter.error({
      rule: "header-use",
      message: `identity '${entry.id}' sets a schema on header '${header}', whose declaration already has one`,
      fix: "Set the schema in one place: remove it from the use, or from the declaration.",
      pointer: schemaPointer,
      related: [
        {
          pointer: accessIdentityPointer(declared.pointer, "schema"),
          message: "the declaration's schema",
        },
      ],
    });
    return undefined;
  }

  const semantic = declared.declaration.semantic;
  if (semantic === "actorSurface" && !written && !declared.schemaWritten) {
    reporter.error({
      rule: "header-use",
      message: `actorSurface header '${header}' has no schema in its declaration or in identity '${entry.id}'`,
      fix: "Name the enum of the product's surfaces, as 'schema: { enum: Surface }', on the declaration or the use.",
      pointer,
    });
    return undefined;
  }

  if (!written) return undefined;
  const schema = accessIdentitySchemaUse(entry.context, schemaPointer, declared.direction);
  if (semantic === "actorSurface" && schema.kind !== "enum") {
    reporter.error(
      accessIdentityActorSurfaceRefusal("header-use", header, schemaPointer, schema.kind),
    );
    return undefined;
  }
  return schema;
}

type VersionTokenMembers = Pick<IrWriter.IdentityHeaderUse, "from" | "stale">;

// ADR 0002 section 9: a versionToken use names the principal field it carries (`from`) and the code answered to a
// stale request header (`stale`); no other use takes either.
function versionTokenMembers(
  entry: IdentityEntry,
  principal: IrWriter.KnownPrincipal,
  declared: AccessIdentityHeader,
  header: string,
  pointer: string,
  raw: AccessIdentityRawObject,
): VersionTokenMembers | undefined {
  const { reporter } = entry;
  const from = accessIdentityString(raw, "from");
  const stale = accessIdentityString(raw, "stale");

  if (declared.declaration.semantic !== "versionToken") {
    const written = [
      ...(from === undefined ? [] : ["from"]),
      ...(stale === undefined ? [] : ["stale"]),
    ];
    if (written.length === 0) return {};
    reporter.error({
      rule: "header-use",
      message: `identity '${entry.id}' sets ${written.map((member) => `'${member}'`).join(" and ")} on ${declared.declaration.semantic} header '${header}'`,
      fix: "Remove them: only a versionToken use names the principal field it carries and its stale code.",
      pointer,
    });
    return undefined;
  }

  if (from === undefined || stale === undefined) {
    reporter.error({
      rule: "header-use",
      message: `identity '${entry.id}' uses versionToken header '${header}' without ${from === undefined ? "'from'" : "'stale'"}`,
      fix: "Name the principal field the token carries, 'from: principal.<field>', and the code a stale request header answers, 'stale: <code>'.",
      pointer,
    });
    return undefined;
  }

  const source = accessIdentityValueSource(from);
  const field = source.name ?? "";
  if (!accessIdentityPrincipalHasField(entry.catalogues.schemas, principal, field)) {
    reporter.error({
      rule: "principal-field",
      message: `identity '${entry.id}' reads header '${header}' from principal field '${field}', which its principal does not hold${principal.kind === "variants" ? " in every variant" : ""}`,
      fix: "Name a field of the principal schema, or add it to the schema.",
      pointer: accessIdentityPointer(pointer, "from"),
    });
    return undefined;
  }

  return { from: source, stale };
}
