// The four file kinds of ADR 0002 section 1: workspace, api, base and pack.

import {
  A2,
  A8,
  choice,
  conflict,
  forbid,
  type JsonSchema,
  keyNames,
  kw,
  list,
  map,
  object,
  oneOfValues,
  ref,
  req,
  str,
  when,
} from "../dsl.js";
import { MARKERS } from "../markers.js";
import { type Catalogue, catalogues } from "./catalogues.js";
import { CONTROL, KEYS } from "./common.js";

const SEMVER =
  "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$";

// A pack reference: a path, or a package name (ADR 0002 section 2).
const packReference = (): JsonSchema => ({
  title: "pack reference",
  description: "A path starting with ./ or ../, or a package name (ADR 0002 section 2).",
  type: "string",
  pattern: `^[^${CONTROL}]+$`,
});

// The effects of a derive entry (ADR 0002 section 2); the first is the key a missing effect names.
const DERIVE_EFFECTS = ["declareRight", "require", "attachErrors"] as const;

const ONE_SOURCE =
  "An import takes one source form: 'package' with 'version', 'release', or 'git'.";

// ADR 0002 section 1, ADR 0011: exactly one source form.
const importSource = (): JsonSchema => ({
  ...when(
    req("package"),
    {
      properties: { release: conflict(ONE_SOURCE), git: conflict(ONE_SOURCE) },
      // An included file may bring 'version'.
      ...when(req("$include"), undefined, req("version")),
    },
    {
      properties: { version: conflict("'version' goes with 'package'.") },
      ...when(req("release"), forbid(["git"], ONE_SOURCE), {
        ...when(req("git"), undefined, {
          ...when(
            req("$include"),
            undefined,
            choice("a source form: 'package' with 'version', 'release', or 'git'", "package"),
          ),
        }),
      }),
    },
  ),
});

function catalogueKeys(list: Catalogue[]): Record<string, JsonSchema> {
  return Object.fromEntries(list.map((c) => [c.file, kw(c.section, ref(c.file), c.description)]));
}

// The keys every api, base and pack may hold: the catalogues, conventions, extensions and lint.
function sharedKeys(): Record<string, JsonSchema> {
  return {
    ...catalogueKeys(catalogues()),
    conventions: kw(A2(13), ref("conventions")),
    extensions: kw(A2(12), ref("base", "extensions")),
    lint: kw(A2(12), ref("common", "lintRules")),
  };
}

const packs = (): JsonSchema =>
  kw(A2(2), list(packReference()), "Convention packs, applied in order (ADR 0002 section 2).");

export function workspaceFile(): JsonSchema {
  return object({
    description: "The workspace entry file (ADR 0002 section 1).",
    props: {
      workspace: kw(
        A2(1),
        object({
          props: {
            apis: kw(
              A2(1),
              map({
                keys: KEYS.name,
                keyDescription: "an api name",
                values: ref("common", "path"),
              }),
              "Each api name and its api file.",
            ),
            shared: kw(
              A2(1),
              ref("common", "path"),
              "The file every api builds on, with a base's keys.",
            ),
            editorSchemas: kw(
              A2(1),
              str({ minLength: 1 }),
              "Where compile --editor-schemas writes.",
            ),
            imports: kw(
              A2(1),
              map({
                keys: KEYS.name,
                keyDescription: "an api name",
                values: ref("workspace", "import"),
              }),
              "Apis held in pinned contract bundles.",
            ),
          },
        }),
      ),
    },
    required: ["workspace"],
  });
}

export function workspaceDefs(): Record<string, JsonSchema> {
  return {
    // ADR 0002 section 1, ADR 0011: one source form, the api's name and the required integrity.
    import: object({
      props: {
        package: kw(A2(1), str({ minLength: 1 })),
        version: kw(A2(1), str({ minLength: 1 })),
        release: kw(
          A2(1),
          object({
            props: { url: kw(A2(1), str({ minLength: 1 })) },
            required: ["url"],
          }),
        ),
        git: kw(
          A2(1),
          object({
            props: {
              url: kw(A2(1), str({ minLength: 1 })),
              tag: kw(A2(1), str({ minLength: 1 })),
              directory: kw(A2(1), str({ minLength: 1 })),
            },
            required: ["url", "tag"],
          }),
        ),
        api: kw(A2(1), ref("common", "name")),
        integrity: kw(A2(1), str({ pattern: "^sha256-" })),
      },
      required: ["api", "integrity"],
      rules: [importSource()],
    }),
  };
}

export function apiFile(): JsonSchema {
  return object({
    description: "An api file (ADR 0002 section 1).",
    props: {
      api: kw(A2(5), ref("api", "api")),
      extends: kw(A2(2), ref("common", "path"), "The one base this api extends."),
      packs: packs(),
      surfaces: kw(
        A2(6),
        map({ keys: KEYS.name, keyDescription: "a surface name", values: ref("node", "surface") }),
        "Each surface and the root node of its tree.",
      ),
      ...sharedKeys(),
    },
    required: ["api"],
  });
}

export function apiDefs(): Record<string, JsonSchema> {
  return {
    api: object({
      extensions: true,
      props: {
        name: kw(A2(5), ref("common", "name")),
        version: kw(
          A2(5),
          {
            ...when(
              { type: "string" },
              { type: "string", minLength: 1 },
              { type: "integer", minimum: 0 },
            ),
          },
          "An integer, or a quoted string for a date-versioned api.",
        ),
        kind: kw(A2(5), oneOfValues("product", "service")),
        role: kw(A2(5), oneOfValues("gateway")),
        caller: kw(
          A2(5),
          object({
            props: {
              identity: kw(A2(5), ref("common", "name")),
              right: kw(A2(5), ref("common", "rightName")),
            },
            required: ["identity", "right"],
          }),
        ),
        maturity: kw(A2(5), ref("common", "maturityLevel")),
        compat: kw(
          A2(5),
          object({
            props: { policy: kw(A2(5), oneOfValues("additive-only", "none")) },
            required: ["policy"],
          }),
        ),
        documents: kw(
          A2(5),
          map({
            keys: KEYS.name,
            keyDescription: "a document name",
            values: object({
              props: {
                surfaces: kw(A2(5), ref("common", "names")),
                internal: kw(A2(5), oneOfValues("include", "exclude")),
              },
            }),
          }),
        ),
        summary: kw(A2(5), ref("common", "summary")),
        description: kw(A2(5), ref("common", "description")),
      },
      required: ["name", "version"],
      // A service api states its caller (grammar section 5); an included fragment may supply it.
      rules: [
        when(
          { properties: { kind: { const: "service" } }, required: ["kind"] },
          when(req("$include"), undefined, req("caller")),
        ),
      ],
    }),
  };
}

export function baseFile(): JsonSchema {
  return object({
    description: "A base, or the workspace's shared file (ADR 0002 section 1).",
    props: { packs: packs(), ...sharedKeys() },
  });
}

export function baseDefs(): Record<string, JsonSchema> {
  return {
    // ADR 0002 section 12, ADR 0008: consumer extension keys under a prefix.
    extensions: {
      description: "Consumer extension keys, each declared with a schema under a prefix.",
      type: "object",
      properties: {
        $include: ref("common", "include"),
        seampact: {
          title: MARKERS.reserved,
          description: "The extension prefix 'seampact' is reserved (ADR 0008).",
          not: {},
        },
      },
      propertyNames: keyNames(KEYS.extensionPrefix, "an extension prefix", A2(12)),
      additionalProperties: map({
        keys: KEYS.extensionKey,
        keyDescription: "an extension key",
        keySection: A2(12),
        values: object({
          props: {
            at: kw(
              A2(12),
              list(
                oneOfValues("api", "operation", "schema", "property", "right", "rule", "scope"),
                {
                  minItems: 1,
                },
              ),
            ),
            schema: kw(A2(12), ref("schema", "schema")),
          },
          required: ["at", "schema"],
        }),
      }),
    },
  };
}

export function packFile(): JsonSchema {
  return object({
    description:
      "A convention pack: data only, the keys of a base plus its manifest and derive entries (ADR 0002 section 2, ADR 0008).",
    props: {
      pack: kw(A2(2), ref("pack", "manifest")),
      ...sharedKeys(),
      derive: kw(A2(2), list(ref("pack", "entry")), "Derivation entries, applied in order."),
    },
    required: ["pack"],
  });
}

export function packDefs(): Record<string, JsonSchema> {
  const opNames = oneOfValues("list", "get", "create", "update", "delete", "batch");

  return {
    manifest: object({
      props: {
        name: kw(
          A2(2),
          str({ minLength: 1 }),
          "The package name, or a name of the contract's choosing.",
        ),
        version: kw(A2(2), str({ pattern: SEMVER }), "The pack's semver version."),
        extends: kw(A2(2), list(packReference()), "Packs applied just before this one."),
      },
      required: ["name", "version"],
    }),
    // ADR 0002 section 2, ADR 0008: a selector and effects from closed sets.
    entry: object({
      title: MARKERS.deriveEntry,
      props: {
        entry: kw(A2(2), ref("common", "name"), "The entry's name, unique in the pack."),
        select: kw(
          A2(2),
          object({
            props: {
              op: kw(A8, list(opNames, { minItems: 1 })),
              access: kw(A8, list(oneOfValues("read", "write"), { minItems: 1 })),
              apiKind: kw(A8, list(oneOfValues("product", "service"), { minItems: 1 })),
              identity: kw(A8, list(ref("common", "name"), { minItems: 1 })),
              tag: kw(A8, list(str({ minLength: 1 }), { minItems: 1 })),
            },
          }),
        ),
        declareRight: kw(
          A2(2),
          object({
            props: {
              name: kw(A2(2), str({ minLength: 1 }), "A template over {resource} and {op}."),
              subject: kw(
                A2(2),
                object({
                  props: {
                    member: kw(A2(2), oneOfValues("resource", "none")),
                    collection: kw(A2(2), oneOfValues("innermostScope", "none")),
                  },
                }),
              ),
              errors: kw(A2(2), ref("common", "errorCodes")),
            },
            required: ["name"],
          }),
        ),
        require: kw(
          A2(2),
          object({
            props: {
              right: kw(A2(2), str({ minLength: 1 }), "A template over {resource} and {op}."),
              rule: kw(A2(2), ref("common", "name")),
              params: kw(A2(2), { type: "object" }),
              bucket: kw(A2(2), ref("common", "name")),
            },
            // The node requirement's shape: `{ right }`, or `{ rule, params, bucket }`.
            rules: [
              {
                ...when(
                  req("right"),
                  forbid(
                    ["rule", "params", "bucket"],
                    "A derived right takes its params from the template; 'rule', 'params' and 'bucket' belong to a rule.",
                  ),
                  {
                    ...when(
                      req("$include"),
                      undefined,
                      choice(
                        "a right ({ right: <template> }) or a rule ({ rule, params, bucket })",
                        "rule",
                      ),
                    ),
                  },
                ),
              },
            ],
          }),
        ),
        attachErrors: kw(A2(2), ref("common", "errorCodes")),
      },
      required: ["entry", "select"],
      // At least one effect; an included entry may bring it. Stated on the effect keys, so an
      // unknown key does not count as one and a missing 'select' is not also a missing effect.
      rules: [
        {
          ...when({ anyOf: [req("$include"), ...DERIVE_EFFECTS.map((k) => req(k))] }, undefined, {
            title: MARKERS.deriveEntry,
            ...req(DERIVE_EFFECTS[0]),
          }),
        },
      ],
    }),
  };
}
