import type { ClientDescriptor, GeneratedFile, TypesDescriptor } from "@seampact/codegen-core";
import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import type { ContractIR } from "@seampact/spec/ir";
import ts from "typescript";
import { expect, test } from "vitest";
import { CLIENT_MODULE, INDEX_MODULE, MODULE_EXTENSION } from "./client-module.js";
import { target as clientTarget } from "./index.js";
import { ERROR_STYLES } from "./options.js";

const API = "tasks";
const RE_EXPORT_ALL = `./${CLIENT_MODULE}.js`;

interface DescribedClient {
  readonly descriptor: ClientDescriptor;
  readonly files: readonly GeneratedFile[];
}

// A types descriptor naming one module per role: the client's own exports do not depend on the type names.
function typesDescriptorOf(ir: ContractIR): TypesDescriptor {
  const typeExport = (operationId: string, role: string) => ({
    module: "operations",
    export: `${operationId}${role}`,
  });

  return {
    kind: "types",
    style: "typescript",
    schemas: {},
    operations: Object.fromEntries(
      ir.operations.map((operation) => [
        operation.id,
        {
          input: typeExport(operation.id, "Input"),
          output: typeExport(operation.id, "Output"),
          errors: typeExport(operation.id, "Errors"),
        },
      ]),
    ),
  };
}

async function describedClient(errorStyle: string): Promise<DescribedClient> {
  const ir = readGoldenIr(API);
  const typesDescriptor = typesDescriptorOf(ir);

  const options = { errorStyle };
  const generated = await clientTarget.generate({
    ir,
    options,
    links: {
      types: { descriptor: typesDescriptor, location: { kind: "relative", path: "../types" } },
    },
    artefacts: new Set(["client"]),
  });
  const described = clientTarget.describe(ir, options);
  const descriptor = described.status === "described" ? described.descriptors.client : undefined;

  if (generated.status !== "generated" || descriptor === undefined) {
    throw new Error(`codegen-fetch refused ${API}: ${JSON.stringify([generated, described])}`);
  }

  return { descriptor, files: generated.files };
}

function sourceOf(files: readonly GeneratedFile[], module: string): ts.SourceFile {
  const path = `${module}${MODULE_EXTENSION}`;
  const file = files.find((each) => each.path === path);

  if (file === undefined) throw new Error(`the client generated no ${path}`);

  return ts.createSourceFile(path, file.contents, ts.ScriptTarget.Latest);
}

function isExported(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

// The names a module exports by declaration (`export function`, `export interface`, ...).
function declaredExports(source: ts.SourceFile): string[] {
  return source.statements.flatMap((statement) => {
    if (!isExported(statement)) return [];

    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      return [statement.name.text];
    }

    return [];
  });
}

// The names the index module exports: its named re-exports, and every declaration of the client module it
// re-exports whole.
function indexExports(files: readonly GeneratedFile[]): Set<string> {
  const index = sourceOf(files, INDEX_MODULE);

  const names = index.statements.flatMap((statement) => {
    if (!ts.isExportDeclaration(statement)) return [];

    const clause = statement.exportClause;

    if (clause !== undefined && ts.isNamedExports(clause)) {
      return clause.elements.map((element) => element.name.text);
    }

    const specifier = statement.moduleSpecifier;

    if (
      specifier !== undefined &&
      ts.isStringLiteral(specifier) &&
      specifier.text === RE_EXPORT_ALL
    ) {
      return declaredExports(sourceOf(files, CLIENT_MODULE));
    }

    return [];
  });

  return new Set(names);
}

function clientInterfaceMembers(files: readonly GeneratedFile[]): string[] {
  const client = sourceOf(files, CLIENT_MODULE).statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === "Client",
  );

  if (client === undefined) throw new Error("the client module declares no Client interface");

  return client.members.flatMap((member) =>
    member.name !== undefined && ts.isIdentifier(member.name) ? [member.name.text] : [],
  );
}

test.each(ERROR_STYLES)(
  "every export the %s client descriptor names is exported by its index",
  async (errorStyle) => {
    const { descriptor, files } = await describedClient(errorStyle);
    const exported = indexExports(files);

    expect(descriptor.errorStyle).toBe(errorStyle);
    expect(Object.values(descriptor.exports).map((ref) => ref.module)).toEqual(
      Object.values(descriptor.exports).map(() => INDEX_MODULE),
    );
    expect(
      Object.values(descriptor.exports)
        .map((ref) => ref.export)
        .filter((name) => !exported.has(name)),
    ).toEqual([]);
  },
);

test("the client descriptor names the method of every operation, each a member of Client", async () => {
  const { descriptor, files } = await describedClient("result");
  const ir = readGoldenIr(API);

  expect(Object.keys(descriptor.operations).sort()).toEqual(
    ir.operations.map((operation) => operation.id).sort(),
  );
  expect(
    Object.values(descriptor.operations)
      .map((operation) => operation.method)
      .sort(),
  ).toEqual(clientInterfaceMembers(files).sort());
});
