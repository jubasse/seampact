import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IR_SCHEMA_DOCUMENTS } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { derivationTable } from "../derivations/table.js";
import { type HalfName, type PassName, pipelinePassOf } from "./halves.js";
import {
  draftFieldSegments,
  draftOwnershipRow,
  type OwnershipRow,
  pipelineContainers,
  pipelineOwnership,
} from "./ownership.js";

type Node = Record<string, unknown>;

const DEFINITIONS = new Map<string, Node>();

for (const document of IR_SCHEMA_DOCUMENTS)
  for (const [name, def] of Object.entries((document.$defs ?? {}) as Record<string, Node>))
    DEFINITIONS.set(name, def);

// The schema node after following `$ref`s to a definition.
function deref(node: Node | undefined): Node | undefined {
  let current = node;

  while (current !== undefined && typeof current.$ref === "string")
    current = DEFINITIONS.get(current.$ref.slice(current.$ref.lastIndexOf("/") + 1));

  return current;
}

// A member of an object, or of any variant of a tagged union (`unknownKeys` is a member of `RefTypeUse`).
function memberOf(node: Node, member: string): Node | undefined {
  const properties = node.properties as Record<string, Node> | undefined;

  if (properties !== undefined && Object.hasOwn(properties, member))
    return deref(properties[member]);

  for (const variant of (node.oneOf ?? []) as Node[]) {
    const found = deref(variant);
    const inVariant = found === undefined ? undefined : memberOf(found, member);

    if (inVariant !== undefined) return inVariant;
  }

  return undefined;
}

// The schema node of a normalised path, from ContractIR down.
function schemaAt(segments: readonly string[]): Node | undefined {
  let node = deref(DEFINITIONS.get("ContractIR"));

  for (const segment of segments) {
    if (node === undefined) return undefined;

    if (segment === "[]") node = node.type === "array" ? deref(node.items as Node) : undefined;
    else node = memberOf(node, segment);
  }

  return node;
}

const text = (segments: readonly string[]): string =>
  segments.reduce((path, s) => (s === "[]" ? `${path}[]` : path === "" ? s : `${path}.${s}`), "");

const rowFields = pipelineOwnership.map((row) => row.field);
const rowAtOrAbove = (segments: readonly string[]): OwnershipRow | undefined => {
  for (let i = segments.length; i > 0; i--) {
    const row = draftOwnershipRow(text(segments.slice(0, i)));

    if (row !== undefined) return row;
  }

  return undefined;
};

function rowWriters(row: OwnershipRow): readonly string[] {
  switch (row.mode) {
    case "default":
      return row.order;
    case "owned":
      return [row.owner];
    case "elements":
      return [row.declared, ...row.derived];
  }
}

// The rows strictly below `parent` in the table.
function rowsBelow(table: readonly OwnershipRow[], parent: OwnershipRow): OwnershipRow[] {
  const parentSegments = draftFieldSegments(parent.field);

  return table.filter((row) => {
    const rowSegments = draftFieldSegments(row.field);

    return (
      rowSegments.length > parentSegments.length &&
      parentSegments.every((segment, index) => rowSegments[index] === segment)
    );
  });
}

// A default written where absent is one write, its sub-rows checked by their own rows (guard.ts): each half of
// the default's order must also write each row below it, else the guard refuses that half's whole write.
function defaultHalvesMissingBelow(table: readonly OwnershipRow[]): string[] {
  const missing: string[] = [];

  for (const parent of table) {
    if (parent.mode !== "default") continue;

    for (const row of rowsBelow(table, parent))
      for (const half of parent.order)
        if (!rowWriters(row).includes(half)) missing.push(`${half} on ${row.field}`);
  }

  return missing;
}

describe("field ownership", () => {
  test("every member has one owner", () => {
    // No field twice, and every row and container is a member of the IR schema.
    expect(new Set(rowFields).size, "a field listed twice").toBe(rowFields.length);

    for (const field of [...rowFields, ...pipelineContainers])
      expect(schemaAt(draftFieldSegments(field)), `${field} is no IR member`).toBeDefined();

    // The containers are exactly the fields above rows that no row covers.
    const containers = new Set<string>();

    for (const field of rowFields) {
      const segments = draftFieldSegments(field);

      for (let i = 1; i < segments.length; i++) {
        const above = segments.slice(0, i);

        if (rowAtOrAbove(above) === undefined) containers.add(text(above));
      }
    }

    expect([...containers].sort()).toEqual([...pipelineContainers].sort());

    // A row below another row changes its owner or its mode, else it is noise.
    for (const row of pipelineOwnership) {
      const segments = draftFieldSegments(row.field);
      const above = rowAtOrAbove(segments.slice(0, -1));

      if (above?.mode === "owned" && row.mode === "owned")
        expect(row.owner, `${row.field} repeats ${above.field}`).not.toBe(above.owner);
    }

    // Walk the IR schema from ContractIR down to the rows: every member of a container has a row.
    const unowned: string[] = [];
    const walk = (segments: string[]): void => {
      const node = schemaAt(segments);

      if (node?.type === "array") {
        walk([...segments, "[]"]);

        return;
      }

      for (const member of Object.keys((node?.properties ?? {}) as Node)) {
        const below = [...segments, member];
        const field = text(below);

        if (draftOwnershipRow(field) !== undefined) continue;

        if ((pipelineContainers as readonly string[]).includes(field)) walk(below);
        else unowned.push(field);
      }
    };

    walk([]);
    expect(unowned, "IR members with no owner").toEqual([]);
  });

  test("each half of a default with rows below it writes each of those rows", () => {
    expect(defaultHalvesMissingBelow(pipelineOwnership)).toEqual([]);

    // A table that splits them: access.rights writes a proof-only input's schema, not its unknownKeys.
    const split = pipelineOwnership.map((row) =>
      row.field === "operations[].input.schema.unknownKeys" && row.mode === "default"
        ? { ...row, order: row.order.filter((half) => half !== "access.rights") }
        : row,
    );

    expect(defaultHalvesMissingBelow(split)).toEqual([
      "access.rights on operations[].input.schema.unknownKeys",
    ]);
  });

  test("a list's derived halves are wire owners of derivations", () => {
    const wireOwners = new Set(derivationTable.flatMap((row) => (row.wire ? [row.wire] : [])));

    for (const row of pipelineOwnership)
      if (row.mode === "elements")
        for (const half of row.derived) expect(wireOwners, `${row.field}: ${half}`).toContain(half);
  });

  test("ownership matches ADR 0006", () => {
    const adr = readFileSync(
      fileURLToPath(
        new URL("../../../../../docs/adr/0006-compiler-pass-pipeline.md", import.meta.url),
      ),
      "utf8",
    );
    const section = adr.slice(adr.indexOf("### 3. Field ownership"));
    const cells = new Map<PassName | "link", string>();

    for (const line of section.split("\n").slice(4)) {
      if (!line.startsWith("|")) break;
      const [pass = "", writes = ""] = line
        .slice(1, -1)
        .split(" | ")
        .map((cell) => cell.trim());

      if (pass === "tree" || pass === "access" || pass === "derive" || pass === "link")
        cells.set(pass, writes);
    }

    expect([...cells.keys()]).toEqual(["tree", "access", "derive", "link"]);
    expect(cells.get("link")).toBe("nothing");

    // Backticked mentions that are not a member the pass writes, each with its reason.
    const notMembers: Record<PassName, Record<string, string>> = {
      tree: {},
      access: {},
      derive: {
        "conventions.input.unknownKeys": "the convention derive reads",
        "input.unknownKeys": "the derivation id",
      },
    };
    // Mentions that name a member by another word than its path.
    const aliases: Record<PassName, Record<string, string>> = {
      tree: { fields: "operations[].input.fields", shape: "operations[].responses" },
      access: { unknownKeys: "operations[].input.schema.unknownKeys" },
      derive: { unknownKeys: "operations[].input.schema.unknownKeys" },
    };
    // Rows a pass writes that its ADR row does not mention, each with its reason.
    const unmentioned: Record<PassName, Record<string, string>> = {
      tree: { "operations[].kind": "the operation's declaration kind, written with the operation" },
      access: {
        "operations[].paging.sortKeys[].derivedFrom":
          "carried with the derived right (sortKey.restricted)",
      },
      derive: {},
    };

    // A derived element is written by the halves the row lists in `derived`, so a pass's row in the ADR is
    // checked for the derived elements of its own halves only.
    const writers = (field: string, qualifier: string | undefined): Set<HalfName> => {
      const row = draftOwnershipRow(field);
      const halves = new Set<HalfName>();

      if (row === undefined) {
        for (const other of pipelineOwnership)
          if (other.field.startsWith(field))
            for (const half of writers(other.field, qualifier)) halves.add(half);

        return halves;
      }

      if (row.mode === "owned" && row.owner !== "finalize") halves.add(row.owner);

      if (row.mode === "default") for (const half of row.order) halves.add(half);

      if (row.mode === "elements") {
        if (qualifier !== "derived") halves.add(row.declared);

        if (qualifier !== "declared") for (const half of row.derived) halves.add(half);
      }

      return halves;
    };

    const mentions = new Map<PassName, { field: string; qualifier: string | undefined }[]>();

    for (const pass of ["tree", "access", "derive"] as const) {
      const cell = cells.get(pass) ?? "";
      const split = cell.indexOf("per operation:");
      const found: { field: string; qualifier: string | undefined }[] = [];

      for (const match of cell.matchAll(/(?:(declared|derived) )?`([^`]+)`/g)) {
        const [, qualifier, token = ""] = match;

        if (Object.hasOwn(notMembers[pass], token)) continue;
        const perOperation = (match.index ?? 0) > split;
        const field = Object.hasOwn(aliases[pass], token)
          ? (aliases[pass][token] ?? token)
          : perOperation
            ? `operations[].${token}`
            : token;

        found.push({ field, qualifier });
        const halves = [...writers(field, qualifier)].map(pipelinePassOf);

        expect(halves, `${pass} writes ${field} in ADR 0006`).toContain(pass);
      }

      mentions.set(pass, found);
    }

    // The other way: every row a pass may write is mentioned in its ADR row (the field or a field above it).
    for (const row of pipelineOwnership) {
      const halves =
        row.mode === "owned"
          ? row.owner === "finalize"
            ? []
            : [row.owner]
          : row.mode === "default"
            ? row.order
            : [row.declared, ...row.derived];

      for (const half of halves) {
        const pass = pipelinePassOf(half);

        if (Object.hasOwn(unmentioned[pass], row.field)) continue;
        const segments = draftFieldSegments(row.field);
        const mentioned = (mentions.get(pass) ?? []).some(({ field }) =>
          draftFieldSegments(field).every((s, i) => segments[i] === s),
        );

        expect(mentioned, `${row.field} (${half}) is not in ADR 0006's ${pass} row`).toBe(true);
      }
    }
  });
});
