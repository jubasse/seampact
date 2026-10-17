import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkIrSupport,
  createIrValidator,
  IR_REVISION,
  IR_VERSION,
  type IrSupport,
  type IrValidationReport,
  walkIrInstance,
} from "@seampact/spec/ir";
import { Ajv2020 } from "ajv/dist/2020.js";
import { biomeStableJson, type JsonValue } from "./generate.ts";

// The reader parity corpus (ADR 0010): IR documents with the verdict of the TypeScript reader, which the Kotlin and
// PHP readers must give too. A case is an example document, edits applied to it, number literals written into it
// as text, and the support declaration it is read with. The verdict compares the outcome, the code and the member of
// each refusal, never the message text.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const CORPUS_FILE = "packages/core/spec/vectors/ir/cases.json";

export const EXAMPLES_DIRECTORY = "packages/core/spec/schemas/ir/examples";

/** The refusal of an unknown tag or value of a must-act definition: the TypeScript reader has no code for it. */
export const MUST_ACT_CODE = "ir.must-act.unknown";

export type CorpusEdit = { pointer: string; value: JsonValue } | { pointer: string; remove: true };

export type CorpusLiteral = {
  pointer: string;
  /** The number as written in the document text, which a parsed value cannot keep. */
  text: string;
};

export type CorpusRefusal = { code: string; member: string };

export type CorpusVerdict =
  | { outcome: "accept" }
  /** JSON the IR model refuses to decode. */
  | { outcome: "malformed" }
  /**
   * Text that is not JSON. A reader never accepts it: it fails as malformed, or, where the platform parser reads
   * more than JSON (Kotlin reads `3d` as a number), as a refusal.
   */
  | { outcome: "not-json" }
  /** Sorted by member, then code. */
  | { outcome: "refuse"; refusals: CorpusRefusal[] };

export type CorpusCase = {
  id: string;
  example: string;
  support: string;
  edits?: CorpusEdit[];
  literals?: CorpusLiteral[];
  verdict: CorpusVerdict;
};

export type CorpusSupport = {
  irVersions: number[];
  irRevision: number;
  kinds: string[];
  features: string[];
};

type CaseInput = Omit<CorpusCase, "verdict">;

const SUPPORTS: Record<string, Pick<CorpusSupport, "kinds" | "features">> = {
  http: { kinds: ["httpOperation"], features: [] },
  "http-and-channel": { kinds: ["httpOperation", "channel"], features: ["streaming"] },
};

export function corpusSupports(): Record<string, CorpusSupport> {
  return Object.fromEntries(
    Object.entries(SUPPORTS).map(([name, declared]) => [
      name,
      { irVersions: [IR_VERSION], irRevision: IR_REVISION, ...declared },
    ]),
  );
}

const validator = createIrValidator(Ajv2020, "open");

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function refusalsOf(refusals: CorpusRefusal[]): CorpusVerdict {
  return {
    outcome: "refuse",
    refusals: refusals.sort(
      (left, right) => compareText(left.member, right.member) || compareText(left.code, right.code),
    ),
  };
}

function mustActRefusals(report: IrValidationReport): CorpusRefusal[] {
  return [
    ...report.unknownKinds
      .filter((unknown) => unknown.mustAct)
      .map((unknown) => ({ code: MUST_ACT_CODE, member: `${unknown.pointer}/${unknown.tag}` })),
    ...report.unknownValues
      .filter((unknown) => unknown.mustAct)
      .map((unknown) => ({ code: MUST_ACT_CODE, member: unknown.pointer })),
  ];
}

/** What the TypeScript reader does with `text`: the same order of checks as the native readers. */
export function verdictOf(text: string, support: IrSupport): CorpusVerdict {
  let document: unknown;

  try {
    document = JSON.parse(text);
  } catch {
    return { outcome: "not-json" };
  }

  const mismatches = checkIrSupport(document, support);

  if (mismatches.length > 0)
    return refusalsOf(mismatches.map(({ code, member }) => ({ code, member })));

  const report = validator.validate(document);
  const mustAct = mustActRefusals(report);

  if (mustAct.length > 0) return refusalsOf(mustAct);

  return report.problems.length > 0 ? { outcome: "malformed" } : { outcome: "accept" };
}

const unescapePointerSegment = (segment: string): string =>
  segment.replaceAll("~1", "/").replaceAll("~0", "~");

function isContainer(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parentOf(root: unknown, segments: string[]): Record<string, unknown> {
  let current = root;

  for (const segment of segments.slice(0, -1)) {
    if (!isContainer(current)) throw new Error(`no member ${segment} on the way`);
    current = current[segment];
  }

  if (!isContainer(current)) throw new Error("the pointer ends outside a container");

  return current;
}

function segmentsOf(pointer: string): string[] {
  return pointer.split("/").slice(1).map(unescapePointerSegment);
}

function setAt(root: unknown, pointer: string, value: JsonValue): void {
  const segments = segmentsOf(pointer);

  // defineProperty, so a member named __proto__ is data and not the prototype.
  Object.defineProperty(parentOf(root, segments), segments.at(-1) ?? "", {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function removeAt(root: unknown, pointer: string): void {
  const segments = segmentsOf(pointer);
  const parent = parentOf(root, segments);
  const last = segments.at(-1) ?? "";

  if (!(last in parent)) throw new Error(`${pointer}: nothing to remove`);
  delete parent[last];
}

export function exampleText(example: string, root = REPO_ROOT): string {
  return readFileSync(join(root, EXAMPLES_DIRECTORY, example), "utf8");
}

const literalPlaceholder = (index: number): string => `literal-placeholder-${index}`;

/** The document text of a case: the example, its edits, then its literals written as they are. */
export function documentTextOf(testCase: CaseInput, root = REPO_ROOT): string {
  const document: unknown = JSON.parse(exampleText(testCase.example, root));

  for (const edit of testCase.edits ?? [])
    if ("remove" in edit) removeAt(document, edit.pointer);
    else setAt(document, edit.pointer, edit.value);

  const literals = testCase.literals ?? [];

  literals.forEach((literal, index) => {
    setAt(document, literal.pointer, literalPlaceholder(index));
  });

  let text = JSON.stringify(document);

  literals.forEach((literal, index) => {
    text = text.replace(`"${literalPlaceholder(index)}"`, () => literal.text);
  });

  return text;
}

// The examples that stand for themselves: what each says is in the IR README, the verdict is computed.
const EXAMPLE_FILES = [
  "every-member.ir.json",
  "minimal.ir.json",
  "unknown-enum-value.ir.json",
  "unknown-kind-and-feature.ir.json",
  "unknown-kind.ir.json",
  "unknown-member.ir.json",
  "unknown-must-act.ir.json",
];

const MINIMAL = "minimal.ir.json";
const EVERY_MEMBER = "every-member.ir.json";
const RESPONSE_STATUS = "/operations/0/responses/0/status";

function exampleCases(): CaseInput[] {
  const cases: CaseInput[] = EXAMPLE_FILES.map((example) => ({
    id: `example/${example.replace(".ir.json", "")}`,
    example,
    support: "http",
  }));

  cases.push({
    id: "example/unknown-kind-and-feature-declared",
    example: "unknown-kind-and-feature.ir.json",
    support: "http-and-channel",
  });

  return cases;
}

function supportCases(): CaseInput[] {
  const edit = (id: string, example: string, pointer: string, value: JsonValue): CaseInput => ({
    id,
    example,
    support: "http",
    edits: [{ pointer, value }],
  });

  return [
    edit("version/two", MINIMAL, "/irVersion", 2),
    edit("version/string", MINIMAL, "/irVersion", String(IR_VERSION)),
    edit("version/null", MINIMAL, "/irVersion", null),
    edit("revision/next", MINIMAL, "/irRevision", IR_REVISION + 1),
    edit("revision/null", MINIMAL, "/irRevision", null),
    edit("kinds/declared-unknown", MINIMAL, "/kinds", ["httpOperation", "channel"]),
    edit("kinds/not-an-array", MINIMAL, "/kinds", "httpOperation"),
    edit("features/declared-unknown", MINIMAL, "/features", ["streaming"]),
    {
      id: "features/missing",
      example: MINIMAL,
      support: "http",
      edits: [{ pointer: "/features", remove: true }],
    },
    edit("operation/kind-unknown", EVERY_MEMBER, "/operations/0/kind", "channel"),
    edit("operation/feature-unknown", EVERY_MEMBER, "/operations/0/features", ["streaming"]),
  ];
}

const CATALOGUE_RIGHT = {
  id: "",
  subject: { kind: "none" },
  guest: "Anyone may read.",
  errors: [],
  docs: {},
  extensions: {},
  origin: { layer: "api", pointer: "" },
};

const CATALOGUE_ERROR = {
  code: "",
  family: "api",
  nature: "failed",
  http: { status: 500 },
  docs: {},
  origin: { layer: "api", pointer: "" },
  default: "undeclaredStatus",
};

function catalogueCase(id: string, catalogue: "rights" | "errors", key: string): CaseInput {
  const pointer = `/${catalogue}/${key}`;
  const entry =
    catalogue === "rights"
      ? { ...CATALOGUE_RIGHT, id: key, origin: { layer: "api", pointer } }
      : { ...CATALOGUE_ERROR, code: key, origin: { layer: "api", pointer } };

  return { id, example: EVERY_MEMBER, support: "http", edits: [{ pointer, value: entry }] };
}

// A catalogue key that looks like an integer, and one that is a JavaScript prototype member name.
function catalogueCases(): CaseInput[] {
  return [
    catalogueCase("catalogue/error-numeric-key", "errors", "1042"),
    catalogueCase("catalogue/right-numeric-key", "rights", "1042"),
    catalogueCase("catalogue/right-proto-key", "rights", "__proto__"),
  ];
}

// A variant used on its own (`Scalar.type`) is not a union: its tag is a fixed value, not a choice.
function standaloneTagCases(): CaseInput[] {
  const pointer = "/scalars/money/type/kind";
  const standalone = (id: string, edit: CorpusEdit): CaseInput => ({
    id,
    example: EVERY_MEMBER,
    support: "http",
    edits: [edit],
  });

  return [
    standalone("standalone-tag/other-variant", { pointer, value: "array" }),
    standalone("standalone-tag/unknown", { pointer, value: "future" }),
    standalone("standalone-tag/missing", { pointer, remove: true }),
  ];
}

interface MustActLocation {
  definition: string;
  pointer: string;
  /** The tag member of a union; absent for an open enum, whose value sits at the pointer. */
  tag?: string;
}

// The first place of every must-act union and open enum in the every-member example.
function mustActLocations(): MustActLocation[] {
  const locations = new Map<string, MustActLocation>();

  walkIrInstance(JSON.parse(exampleText(EVERY_MEMBER)), (node) => {
    if ((node.kind !== "union" && node.kind !== "openEnum") || !node.mustAct) return;
    const definition = node.definition ?? node.pointer;

    if (!locations.has(definition))
      locations.set(definition, {
        definition,
        pointer: node.pointer,
        ...(node.kind === "union" ? { tag: node.tag } : {}),
      });
  });

  return [...locations.values()];
}

function mustActCases(): CaseInput[] {
  return mustActLocations().map(({ definition, pointer, tag }) => ({
    id: `must-act/${definition}`,
    example: EVERY_MEMBER,
    support: "http",
    edits: [{ pointer: tag === undefined ? pointer : `${pointer}/${tag}`, value: "future" }],
  }));
}

const literalCase = (id: string, example: string, pointer: string, text: string): CaseInput => ({
  id,
  example,
  support: "http",
  literals: [{ pointer, text }],
});

const HUNDRED_DIGITS = `1${"0".repeat(99)}`;

// The number literals of the PR #42 reviews: the readers accept and refuse the same text.
function literalCases(): CaseInput[] {
  const revision = (name: string, text: string) =>
    literalCase(`literal/revision-${name}`, MINIMAL, "/irRevision", text);
  const status = (name: string, text: string) =>
    literalCase(`literal/status-${name}`, EVERY_MEMBER, RESPONSE_STATUS, text);

  return [
    revision("trailing-zero", `${IR_REVISION}.0`),
    revision("fraction-rounds-down", `${IR_REVISION}.0000000000000000001`),
    revision("exponent-zero", `${IR_REVISION}e0`),
    revision("exponent-shifted", `${IR_REVISION * 10}e-1`),
    revision("fraction", `${IR_REVISION}.5`),
    revision("beyond-safe-range", "9007199254740993"),
    revision("hundred-digits", HUNDRED_DIGITS),
    revision("huge-exponent", "1e2147483647"),
    revision("java-double-suffix", `${IR_REVISION}d`),
    revision("java-float-suffix", `${IR_REVISION}f`),
    revision("hex-float", "0x1.8p1"),
    revision("plus-sign", `+${IR_REVISION}`),
    revision("leading-zero", `0${IR_REVISION}`),
    revision("bare-decimal-point", `${IR_REVISION}.`),
    revision("no-integer-digits", ".5e1"),
    revision("nan", "NaN"),
    revision("infinity", "Infinity"),
    literalCase("literal/version-trailing-zero", MINIMAL, "/irVersion", `${IR_VERSION}.0`),
    literalCase("literal/version-exponent-zero", MINIMAL, "/irVersion", `${IR_VERSION}e0`),
    literalCase("literal/version-two-point-zero", MINIMAL, "/irVersion", "2.0"),
    literalCase("literal/version-huge-exponent", MINIMAL, "/irVersion", "1e2147483647"),
    status("trailing-zero", "204.0"),
    status("exponent", "2.04e2"),
    status("fraction-rounds-down", "204.0000000000000000001"),
    status("fraction", "204.5"),
    status("beyond-safe-range", "9007199254740993"),
    status("one-e-16", "1e16"),
    status("hundred-digits", HUNDRED_DIGITS),
  ];
}

export function corpusCaseInputs(): CaseInput[] {
  return [
    ...exampleCases(),
    ...supportCases(),
    ...catalogueCases(),
    ...standaloneTagCases(),
    ...mustActCases(),
    ...literalCases(),
  ].sort((left, right) => compareText(left.id, right.id));
}

export function corpusCases(root = REPO_ROOT): CorpusCase[] {
  const supports = corpusSupports();

  return corpusCaseInputs().map((input) => {
    const support = supports[input.support];

    if (support === undefined) throw new Error(`${input.id}: unknown support ${input.support}`);

    return { ...input, verdict: verdictOf(documentTextOf(input, root), support) };
  });
}

/** The corpus file: the support declarations and the cases, in Biome's JSON layout. */
export function generateCorpus(): Map<string, string> {
  const document = {
    irRevision: IR_REVISION,
    supports: corpusSupports(),
    cases: corpusCases(),
  };

  return new Map([[CORPUS_FILE, `${biomeStableJson(document, "")}\n`]]);
}
