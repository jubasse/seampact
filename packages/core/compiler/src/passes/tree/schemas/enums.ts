import type { IrWriter } from "@seampact/spec/ir";
import { segmentsOf, splitName } from "@seampact/spec/naming";
import {
  type TreeSchemasRaw,
  type TreeSchemasReporter,
  treeSchemasEntries,
  treeSchemasMember,
  treeSchemasPointer,
} from "./raw.js";

// The enums catalogue (FR-29, ADR 0002 section 12): values in written order, their source or local reason, code
// names and fallback. An enum taking another's values (`source.enum`) holds them as its own.

type EnumValues = { values: string[] } | { cycle: string[] } | undefined;

const strings = (value: TreeSchemasRaw | undefined): string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

/** What an enum chain already resolved: the values each enum ends on, the code names each one inherits. */
interface EnumChainMemo {
  readonly values: Map<string, string[] | undefined>;
  readonly codeNames: Map<string, WrittenCodeNames>;
}

type WrittenCodeNames = Map<string, { name: TreeSchemasRaw; pointer: string }>;

const newChainMemo = (): EnumChainMemo => ({ values: new Map(), codeNames: new Map() });

// Where a chain stops at `name`: its own values, none, or the enum it takes its values from.
type ChainStep = { end: string[] | undefined } | { next: string };

function chainStep(enums: TreeSchemasRaw | undefined, name: string): ChainStep {
  const declared = treeSchemasMember(enums, name);
  const values = treeSchemasMember(declared, "values");

  if (Array.isArray(values)) return { end: strings(values) };
  const source = treeSchemasMember(treeSchemasMember(declared, "source"), "enum");

  return typeof source === "string" ? { next: source } : { end: undefined };
}

/**
 * The values of the enum `name`, followed through `source.enum` with a list, never by recursion. `memo` keeps
 * the enums of a catalogue already resolved, so each chain is walked once.
 */
export function treeSchemasEnumValues(
  enums: TreeSchemasRaw | undefined,
  name: string,
  memo: EnumChainMemo = newChainMemo(),
): EnumValues {
  const path: string[] = [];
  const onPath = new Set<string>();
  let current = name;

  for (;;) {
    if (onPath.has(current)) return { cycle: [...path.slice(path.indexOf(current)), current] };
    const step = memo.values.has(current)
      ? { end: memo.values.get(current) }
      : chainStep(enums, current);

    if ("end" in step) {
      for (const link of [...path, current]) memo.values.set(link, step.end);

      return step.end === undefined ? undefined : { values: [...step.end] };
    }

    onPath.add(current);
    path.push(current);
    current = step.next;
  }
}

/** Reports why an enum named at `pointer` has no values: it is unknown, or its sources form a cycle. */
export function treeSchemasReportEnumWithoutValues(
  reporter: TreeSchemasReporter,
  name: string,
  found: EnumValues,
  pointer: string,
): void {
  const cycle = found !== undefined && "cycle" in found ? found.cycle : undefined;

  if (cycle === undefined) {
    reporter.error({
      rule: "enum-unknown",
      pointer,
      message: `no enum '${name}' with values is declared`,
      fix: "declare it under 'enums', or fix the name",
    });

    return;
  }

  reporter.error({
    rule: "enum-cycle",
    pointer,
    message: `the enum '${name}' takes its values from a cycle of sources: ${cycle.join(" -> ")}`,
    fix: "give one enum of the cycle its own 'values'",
  });
}

/** Compiles every enum of the catalogue, in written order; a refused one is left out once reported. */
export function treeSchemasCompileEnums(
  enums: TreeSchemasRaw | undefined,
  reporter: TreeSchemasReporter,
): IrWriter.Enum[] {
  const memo = newChainMemo();

  return treeSchemasEntries(enums).flatMap(([id, declared]) => {
    const compiled = compileEnum(enums, id, declared, reporter, memo);

    return compiled === undefined ? [] : [compiled];
  });
}

function compileEnum(
  enums: TreeSchemasRaw | undefined,
  id: string,
  declared: TreeSchemasRaw,
  reporter: TreeSchemasReporter,
  memo: EnumChainMemo,
): IrWriter.Enum | undefined {
  const pointer = treeSchemasPointer("/enums", id);
  const values = valuesOf(enums, id, declared, pointer, reporter, memo);
  const source = sourceOf(declared);
  const reason = treeSchemasMember(declared, "reason");
  const fallback = treeSchemasMember(declared, "fallback");

  if (values === undefined) return undefined;
  let failed = !checkFallback(values, fallback, pointer, reporter);

  if (typeof reason === "string" && source !== undefined) {
    failed = true;
    reporter.error({
      rule: "enum-reason",
      pointer: treeSchemasPointer(pointer, "reason"),
      message: `the enum '${id}' has a source, and a reason says why an enum is local`,
      fix: "remove 'reason', or remove the source of a local enum",
    });
  }

  const codeNames = codeNamesOf(values, { enums, id, pointer, memo }, reporter);

  if (failed || codeNames === undefined) return undefined;
  const summary = treeSchemasMember(declared, "summary");
  const description = treeSchemasMember(declared, "description");

  return {
    id,
    name: { segments: splitName(id), role: "schema" },
    values,
    ...(Object.keys(codeNames).length === 0 ? {} : { codeNames }),
    ...(source === undefined ? {} : { source }),
    ...(typeof reason === "string" ? { localReason: reason } : {}),
    ...(typeof fallback === "string" ? { fallback } : {}),
    directions: [],
    docs: {
      ...(typeof summary === "string" ? { summary } : {}),
      ...(typeof description === "string" ? { description } : {}),
    },
    origin: reporter.origin(pointer),
  };
}

function sourceOf(declared: TreeSchemasRaw): IrWriter.EnumSource | undefined {
  const source = treeSchemasMember(declared, "source");
  const vocabulary = treeSchemasMember(source, "vocabulary");
  const other = treeSchemasMember(source, "enum");

  if (typeof vocabulary === "string") return { kind: "vocabulary", vocabulary };

  return typeof other === "string" ? { kind: "enum", enum: other } : undefined;
}

function valuesOf(
  enums: TreeSchemasRaw | undefined,
  id: string,
  declared: TreeSchemasRaw,
  pointer: string,
  reporter: TreeSchemasReporter,
  memo: EnumChainMemo,
): string[] | undefined {
  const written = treeSchemasMember(declared, "values");
  const other = treeSchemasMember(treeSchemasMember(declared, "source"), "enum");
  const problem =
    written === undefined && typeof other !== "string"
      ? {
          message: `the enum '${id}' declares no values`,
          fix: "write 'values', or 'source: { enum: <Enum> }'",
        }
      : written !== undefined && typeof other === "string"
        ? {
            message: `the enum '${id}' takes the values of '${other}' and writes values of its own`,
            fix: "remove 'values', or the 'source.enum'",
          }
        : undefined;

  if (problem !== undefined) {
    reporter.error({ rule: "enum-values", pointer, ...problem });

    return undefined;
  }

  if (typeof other === "string") {
    const found = treeSchemasEnumValues(enums, id, memo);

    if (found !== undefined && "values" in found) return found.values;
    treeSchemasReportEnumWithoutValues(
      reporter,
      other,
      found,
      treeSchemasPointer(pointer, "source", "enum"),
    );

    return undefined;
  }

  return uniqueValues(strings(written), treeSchemasPointer(pointer, "values"), reporter);
}

function uniqueValues(
  values: string[],
  pointer: string,
  reporter: TreeSchemasReporter,
): string[] | undefined {
  const repeated = values.filter((value, index) => values.indexOf(value) !== index);

  for (const value of new Set(repeated)) {
    reporter.error({
      rule: "enum-values",
      pointer,
      message: `the value '${value}' is listed twice`,
      fix: "list each value once",
    });
  }

  return repeated.length === 0 ? values : undefined;
}

function checkFallback(
  values: readonly string[],
  fallback: TreeSchemasRaw | undefined,
  pointer: string,
  reporter: TreeSchemasReporter,
): boolean {
  if (typeof fallback !== "string" || values.includes(fallback)) return true;
  reporter.error({
    rule: "enum-fallback",
    pointer: treeSchemasPointer(pointer, "fallback"),
    message: `the fallback '${fallback}' is not a value of the enum`,
    fix: `name one of [${values.join(", ")}]`,
  });

  return false;
}

// ADR 0007 sections 1 and 2: a code name replaces a value's segments, a value with none is named `value<position>`,
// and two values with equal segments collide.
// An enum taking another's values takes its code names too, its own winning. The `source.enum` chain is walked
// once, then folded from its root, so a long chain costs one pass and no recursion. A chain that comes back on
// itself is refused before this runs, and its names are not kept.
function writtenCodeNames(
  enums: TreeSchemasRaw | undefined,
  id: string,
  memo: EnumChainMemo,
): WrittenCodeNames {
  const chain: string[] = [];
  const before = new Set<string>();
  let current = id;
  let inherited: WrittenCodeNames = new Map();
  let cyclic = false;

  for (;;) {
    const known = memo.codeNames.get(current);

    if (known !== undefined) {
      inherited = known;
      break;
    }

    chain.push(current);
    const source = treeSchemasMember(
      treeSchemasMember(treeSchemasMember(enums, current), "source"),
      "enum",
    );

    if (typeof source !== "string") break;
    cyclic = before.has(source);

    if (cyclic) break;
    before.add(current);
    current = source;
  }

  for (const link of chain.toReversed()) {
    inherited = new Map(inherited);

    for (const [value, name] of treeSchemasEntries(
      treeSchemasMember(treeSchemasMember(enums, link), "codeNames"),
    ))
      inherited.set(value, {
        name,
        pointer: treeSchemasPointer("/enums", link, "codeNames", value),
      });

    if (!cyclic) memo.codeNames.set(link, inherited);
  }

  return inherited;
}

function codeNamesOf(
  values: readonly string[],
  {
    enums,
    id,
    pointer,
    memo,
  }: { enums: TreeSchemasRaw | undefined; id: string; pointer: string; memo: EnumChainMemo },
  reporter: TreeSchemasReporter,
): Record<string, IrWriter.Name> | undefined {
  const written = writtenCodeNames(enums, id, memo);
  const valuesPointer =
    treeSchemasMember(treeSchemasMember(enums, id), "values") !== undefined
      ? treeSchemasPointer(pointer, "values")
      : treeSchemasPointer(pointer, "source", "enum");
  const codeNames: Record<string, IrWriter.Name> = {};
  const identifiers = new Map<string, string>();
  let failed = false;
  const fail = (problem: { pointer: string; message: string; fix: string; rule: string }) => {
    failed = true;
    reporter.error(problem);
  };

  for (const [value, { pointer: at }] of written) {
    if (!values.includes(value))
      fail({
        rule: "enum-code-name",
        pointer: at,
        message: `'${value}' is not a value of the enum`,
        fix: "give code names to the enum's values only",
      });
  }

  for (const [index, value] of values.entries()) {
    const codeName = written.get(value);
    const name = codeName?.name;
    const at = codeName?.pointer ?? valuesPointer;
    const result = segmentsOf(value, "enumValue", {
      ...(typeof name === "string" ? { codeName: name } : {}),
      position: index + 1,
    });

    if (!result.ok) {
      fail({
        rule: "name-segments",
        pointer: at,
        message: `the code name of the value '${value}' yields no identifier segment`,
        fix: "give it a code name with at least one letter or digit",
      });
      continue;
    }

    const { segments } = result;

    if (typeof name === "string") codeNames[value] = { segments, role: "enumMember" };
    const other = identifiers.get(segments.join(" "));

    if (other !== undefined)
      fail({
        rule: "name-collision",
        pointer: at,
        message: `the values '${other}' and '${value}' give the same identifier`,
        fix: "give one of them a code name",
      });
    identifiers.set(segments.join(" "), value);
  }

  return failed ? undefined : codeNames;
}
