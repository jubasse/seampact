import type { SchemaNode } from "@seampact/spec/ir";
import { describe, expect, it } from "vitest";
import { generateIrModels } from "./generate.ts";
import { buildNeutralModel } from "./model.ts";
import { NameCollisionError } from "./names.ts";
import { PYTHON_MODEL_DIRECTORY } from "./python.ts";
import { docstringLines, PYTHON_LINE_LENGTH } from "./python-printer.ts";

const DEFINITIONS_MODULE = `${PYTHON_MODEL_DIRECTORY}/__init__.py`;

function synthetic(definitions: Record<string, SchemaNode>): SchemaNode[] {
  return [
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://seampact.dev/schemas/ir/synthetic.schema.json",
      $defs: definitions,
    },
  ];
}

function pythonModule(files: Map<string, string>, path: string): string {
  const module = files.get(path);

  if (module === undefined) throw new Error(`${path} is not generated`);

  return module;
}

describe("python ir model", () => {
  it("every definition is generated", () => {
    const module = pythonModule(generateIrModels(), DEFINITIONS_MODULE);

    for (const definition of buildNeutralModel().definitions) {
      if (definition.kind === "alias" || definition.kind === "extensionSlot")
        expect(module, definition.name).toContain(`\ntype ${definition.name} = `);
      else expect(module, definition.name).toMatch(new RegExp(`\\nclass ${definition.name}\\(?`));

      if (definition.kind === "union" || definition.kind === "openEnum")
        expect(module, definition.name).toContain(`\nclass ${definition.name}Unknown(`);
    }
  });

  it("every must-act definition is marked in the shape table", () => {
    const shapes = pythonModule(generateIrModels(), `${PYTHON_MODEL_DIRECTORY}/shapes.py`);

    for (const definition of buildNeutralModel().definitions) {
      if (definition.kind !== "union" && definition.kind !== "openEnum") continue;
      const entry = shapes.split(`\n    "${definition.name}": `)[1] ?? "";

      expect(entry, definition.name).toMatch(
        definition.mustAct ? /^\w+Shape\([^\n]*True|^\w+Shape\(\n[\s\S]*?True,/ : /^\w+Shape\(/,
      );
    }
  });

  it("members take snake case and a keyword takes a trailing underscore", () => {
    const module = pythonModule(
      generateIrModels(
        synthetic({
          Holder: {
            type: "object",
            properties: { in: { type: "string" }, derivedFrom: { type: "string" } },
            required: ["in"],
          },
        }),
      ),
      DEFINITIONS_MODULE,
    );

    expect(module).toContain("    in_: str\n");
    expect(module).toContain("    derived_from: str | None = None\n");
    expect(module).toContain('in_=required(members, "in", "Holder", string_reader("Holder.in")),');
    expect(module).toContain('json["derivedFrom"] = self.derived_from');
  });

  it("a member named field never shadows the dataclass field function", () => {
    const module = pythonModule(
      generateIrModels(
        synthetic({ Holder: { type: "object", properties: { field: { type: "string" } } } }),
      ),
      DEFINITIONS_MODULE,
    );

    expect(module).toContain("from dataclasses import field as _dataclass_field\n");
    expect(module).toContain("    field: str | None = None\n");
    expect(module).not.toMatch(/= field\(/);
  });

  it("two members with the same snake case name fail generation", () => {
    const documents = synthetic({
      Holder: {
        type: "object",
        properties: { derivedFrom: { type: "string" }, derived_from: { type: "string" } },
      },
    });

    expect(() => generateIrModels(documents)).toThrow(NameCollisionError);
    expect(() => generateIrModels(documents)).toThrow(
      /derived_from collides with the member derivedFrom/,
    );
  });

  it("a definition named like a name the module imports fails generation", () => {
    const documents = synthetic({ Mapping: { type: "object", properties: {} } });

    expect(() => generateIrModels(documents)).toThrow(/its Python name Mapping collides/);
  });

  it("a definition named like an open enum's Unknown class fails generation", () => {
    const documents = synthetic({
      Color: { type: "string", "x-seampact-known": ["red"] },
      ColorUnknown: { type: "object", properties: {} },
    });

    expect(() => generateIrModels(documents)).toThrow(/Unknown class/);
  });

  it("a docstring too long for one line keeps at least two text lines", () => {
    const words = "word ".repeat(30).trim();
    const lines = docstringLines(words, "    ");

    expect(lines.at(-1)).toBe('    """');
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((line) => line.length <= PYTHON_LINE_LENGTH)).toBe(true);
  });
});
