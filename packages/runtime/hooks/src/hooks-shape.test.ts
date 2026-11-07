// Checks the package's exported types against the shape manifest the Java and PHP hooks packages share.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIRECTORY = dirname(SOURCE_DIRECTORY);
const MANIFEST_PATH = join(PACKAGE_DIRECTORY, "../../../fixtures/hooks-shape/shape.json");
const NPM_LANGUAGE = "npm";
const NESTED_TYPE_SEPARATOR = ".";
const AWAITABLE_ALIAS = "Awaitable";

interface ShapeMember {
  readonly name: string;
  readonly optional?: boolean;
  readonly nullable?: boolean;
  readonly enum?: string;
  readonly languages?: readonly string[];
}

interface ShapeDiscriminant {
  readonly member: string;
  readonly value: string | boolean;
}

interface ShapeArm {
  readonly name?: string;
  readonly type?: string;
  readonly discriminant?: ShapeDiscriminant;
  readonly members?: readonly ShapeMember[];
}

interface ShapeMethod {
  readonly name: string;
  readonly parameters: readonly string[];
  readonly returns?: string;
}

interface ShapeType {
  readonly name: string;
  readonly kind: "alias" | "record" | "interface" | "hook" | "union" | "enum" | "class";
  readonly languages?: readonly string[];
  readonly discriminant?: ShapeDiscriminant;
  readonly members?: readonly ShapeMember[];
  readonly arms?: readonly ShapeArm[];
  readonly methods?: readonly ShapeMethod[];
  readonly values?: readonly string[];
}

interface ShapeManifest {
  readonly types: readonly ShapeType[];
}

interface PackageTypes {
  readonly checker: ts.TypeChecker;
  readonly exportsByName: ReadonlyMap<string, ts.Symbol>;
  readonly enumValuesByName: ReadonlyMap<string, readonly string[]>;
}

function readManifest(): ShapeManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

function existsInNpm(entry: { readonly languages?: readonly string[] }): boolean {
  return entry.languages === undefined || entry.languages.includes(NPM_LANGUAGE);
}

// Built once: both tests read the same sources.
let loadedPackageExports: Omit<PackageTypes, "enumValuesByName"> | undefined;

function packageExports(): Omit<PackageTypes, "enumValuesByName"> {
  loadedPackageExports ??= loadPackageExports();

  return loadedPackageExports;
}

function loadPackageExports(): Omit<PackageTypes, "enumValuesByName"> {
  const configPath = join(PACKAGE_DIRECTORY, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, PACKAGE_DIRECTORY);
  const indexPath = join(SOURCE_DIRECTORY, "index.ts");
  const program = ts.createProgram([indexPath], config.options);
  const checker = program.getTypeChecker();

  const indexFile = program.getSourceFile(indexPath);
  const moduleSymbol = indexFile === undefined ? undefined : checker.getSymbolAtLocation(indexFile);

  if (moduleSymbol === undefined) {
    throw new Error(`The TypeScript program has no module for ${indexPath}.`);
  }

  const exportsByName = new Map<string, ts.Symbol>();

  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const isAlias = (exported.flags & ts.SymbolFlags.Alias) !== 0;

    exportsByName.set(exported.name, isAlias ? checker.getAliasedSymbol(exported) : exported);
  }

  return { checker, exportsByName };
}

function propertyTypeText(packageTypes: PackageTypes, property: ts.Symbol): string {
  return packageTypes.checker.typeToString(packageTypes.checker.getTypeOfSymbol(property));
}

function isNullable(packageTypes: PackageTypes, property: ts.Symbol): boolean {
  const propertyType = packageTypes.checker.getTypeOfSymbol(property);
  const parts = propertyType.isUnion() ? propertyType.types : [propertyType];

  return parts.some((part) => (part.flags & ts.TypeFlags.Null) !== 0);
}

function stringLiteralValues(packageTypes: PackageTypes, property: ts.Symbol): string[] {
  const propertyType = packageTypes.checker.getTypeOfSymbol(property);
  const parts = propertyType.isUnion() ? propertyType.types : [propertyType];

  return parts.flatMap((part) => (part.isStringLiteral() ? [part.value] : [])).sort();
}

function isNeverMember(property: ts.Symbol): boolean {
  const declaration = property.declarations?.[0];

  return (
    declaration !== undefined &&
    ts.isPropertySignature(declaration) &&
    declaration.type?.kind === ts.SyntaxKind.NeverKeyword
  );
}

function checkDiscriminant(
  packageTypes: PackageTypes,
  label: string,
  properties: readonly ts.Symbol[],
  discriminant: ShapeDiscriminant,
): string[] {
  const property = properties.find((candidate) => candidate.name === discriminant.member);

  if (property === undefined) {
    return [`${label}.${discriminant.member}: missing in npm`];
  }

  const expectedLiteral = JSON.stringify(discriminant.value);
  const actualLiteral = propertyTypeText(packageTypes, property);

  return actualLiteral === expectedLiteral
    ? []
    : [
        `${label}.${discriminant.member}: npm has ${actualLiteral}, the manifest ${expectedLiteral}`,
      ];
}

function checkMember(
  packageTypes: PackageTypes,
  label: string,
  property: ts.Symbol,
  member: ShapeMember,
): string[] {
  const problems: string[] = [];
  const memberLabel = `${label}.${member.name}`;

  const isOptional = (property.flags & ts.SymbolFlags.Optional) !== 0;

  if (isOptional !== (member.optional ?? false)) {
    problems.push(
      `${memberLabel}: optional is ${isOptional} in npm and ${!isOptional} in the manifest`,
    );
  }

  const nullable = isNullable(packageTypes, property);

  if (nullable !== (member.nullable ?? false)) {
    problems.push(
      `${memberLabel}: nullable is ${nullable} in npm and ${!nullable} in the manifest`,
    );
  }

  if (member.enum !== undefined) {
    const expectedValues = [...(packageTypes.enumValuesByName.get(member.enum) ?? [])].sort();
    const actualValues = stringLiteralValues(packageTypes, property);

    if (actualValues.join("|") !== expectedValues.join("|")) {
      problems.push(
        `${memberLabel}: npm has ${actualValues.join(" | ")}, enum ${member.enum} has ${expectedValues.join(" | ")}`,
      );
    }
  }

  return problems;
}

function checkMembers(
  packageTypes: PackageTypes,
  label: string,
  properties: readonly ts.Symbol[],
  members: readonly ShapeMember[],
  discriminant: ShapeDiscriminant | undefined,
): string[] {
  const problems: string[] = [];
  const npmMembers = members.filter(existsInNpm);
  const propertiesByName = new Map(properties.map((property) => [property.name, property]));

  for (const member of npmMembers) {
    const property = propertiesByName.get(member.name);

    if (property === undefined) {
      problems.push(`${label}.${member.name}: missing in npm`);
      continue;
    }

    problems.push(...checkMember(packageTypes, label, property, member));
  }

  if (discriminant !== undefined) {
    problems.push(...checkDiscriminant(packageTypes, label, properties, discriminant));
  }

  const listedNames = new Set([...npmMembers.map((member) => member.name), discriminant?.member]);

  for (const property of properties) {
    if (!listedNames.has(property.name)) {
      problems.push(`${label}.${property.name}: in npm but not in the manifest`);
    }
  }

  return problems;
}

// The declared return type name, with the Awaitable wrapper removed.
function declaredReturnTypeName(signature: ts.Signature): string | undefined {
  let returnNode = signature.getDeclaration().type;

  if (
    returnNode !== undefined &&
    ts.isTypeReferenceNode(returnNode) &&
    returnNode.typeName.getText() === AWAITABLE_ALIAS
  ) {
    returnNode = returnNode.typeArguments?.[0];
  }

  if (returnNode === undefined) {
    return undefined;
  }

  return ts.isTypeReferenceNode(returnNode) ? returnNode.typeName.getText() : returnNode.getText();
}

function checkMethods(
  packageTypes: PackageTypes,
  label: string,
  properties: readonly ts.Symbol[],
  methods: readonly ShapeMethod[],
): string[] {
  const problems: string[] = [];
  const propertiesByName = new Map(properties.map((property) => [property.name, property]));

  for (const method of methods) {
    const property = propertiesByName.get(method.name);
    const signature = property
      ? packageTypes.checker.getTypeOfSymbol(property).getCallSignatures()[0]
      : undefined;

    if (signature === undefined) {
      problems.push(`${label}.${method.name}: missing in npm`);
      continue;
    }

    const parameterNames = signature.getParameters().map((parameter) => parameter.name);

    if (parameterNames.join(",") !== method.parameters.join(",")) {
      problems.push(
        `${label}.${method.name}: npm takes (${parameterNames.join(", ")}), the manifest (${method.parameters.join(", ")})`,
      );
    }

    const returnName = declaredReturnTypeName(signature);

    if (method.returns !== undefined && returnName !== method.returns) {
      problems.push(
        `${label}.${method.name}: npm returns ${returnName}, the manifest ${method.returns}`,
      );
    }
  }

  const listedNames = new Set(methods.map((method) => method.name));

  for (const property of properties) {
    if (!listedNames.has(property.name)) {
      problems.push(`${label}.${property.name}: in npm but not in the manifest`);
    }
  }

  return problems;
}

// An arm is found by its discriminant value, else by its first member, which only that arm carries.
function findNpmArm(
  packageTypes: PackageTypes,
  npmArms: readonly ts.Type[],
  arm: ShapeArm,
): ts.Type | undefined {
  const discriminant = arm.discriminant;

  if (discriminant !== undefined) {
    return npmArms.find((npmArm) => {
      const property = npmArm.getProperty(discriminant.member);

      return (
        property !== undefined &&
        propertyTypeText(packageTypes, property) === JSON.stringify(discriminant.value)
      );
    });
  }

  const firstMember = arm.members?.[0]?.name;

  return npmArms.find((npmArm) => {
    const property = firstMember === undefined ? undefined : npmArm.getProperty(firstMember);

    return property !== undefined && !isNeverMember(property);
  });
}

function checkUnion(packageTypes: PackageTypes, type: ShapeType, unionType: ts.Type): string[] {
  if (!unionType.isUnion()) {
    return [`${type.name}: npm declares no union`];
  }

  const problems: string[] = [];
  const matchedArms = new Set<ts.Type>();

  for (const arm of type.arms ?? []) {
    const armLabel = `${type.name}.${arm.name ?? arm.type}`;
    const npmArm = findNpmArm(packageTypes, unionType.types, arm);

    if (npmArm === undefined) {
      problems.push(`${armLabel}: missing in npm`);
      continue;
    }

    matchedArms.add(npmArm);
    const presentProperties = npmArm.getProperties().filter((property) => !isNeverMember(property));

    problems.push(
      ...checkMembers(
        packageTypes,
        armLabel,
        presentProperties,
        arm.members ?? [],
        arm.discriminant,
      ),
    );
  }

  const unmatchedArms = unionType.types.filter((npmArm) => !matchedArms.has(npmArm));

  for (const npmArm of unmatchedArms) {
    problems.push(
      `${type.name}: npm arm ${packageTypes.checker.typeToString(npmArm)} is not in the manifest`,
    );
  }

  return problems;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// A nested name `Owner.Member` is, in npm, the anonymous object type of the owner's `member`.
function resolveNpmType(packageTypes: PackageTypes, name: string): ts.Type | undefined {
  const [ownerName = name, nestedName] = name.split(NESTED_TYPE_SEPARATOR);
  const owner = packageTypes.exportsByName.get(ownerName);

  if (owner === undefined) {
    return undefined;
  }

  const ownerType = packageTypes.checker.getDeclaredTypeOfSymbol(owner);

  if (nestedName === undefined) {
    return ownerType;
  }

  const holder = ownerType.getProperty(lowerFirst(nestedName));

  return holder === undefined ? undefined : packageTypes.checker.getTypeOfSymbol(holder);
}

function checkType(packageTypes: PackageTypes, type: ShapeType): string[] {
  const npmType = resolveNpmType(packageTypes, type.name);

  if (npmType === undefined) {
    return [`${type.name}: missing in npm`];
  }

  switch (type.kind) {
    case "record":
    case "interface":
      return checkMembers(
        packageTypes,
        type.name,
        npmType.getProperties(),
        type.members ?? [],
        type.discriminant,
      );
    case "hook":
      return checkMethods(packageTypes, type.name, npmType.getProperties(), type.methods ?? []);
    case "union":
      return checkUnion(packageTypes, type, npmType);
    case "alias":
      return [];
    case "enum":
    case "class":
      return [`${type.name}: a ${type.kind} has no npm form; list it for java and php only`];
  }
}

function checkHooksShape(manifest: ShapeManifest): string[] {
  const enumValuesByName = new Map(
    manifest.types.flatMap((type) =>
      type.kind === "enum" ? [[type.name, type.values ?? []]] : [],
    ),
  );
  const packageTypes: PackageTypes = { ...packageExports(), enumValuesByName };
  const problems: string[] = [];

  for (const type of manifest.types) {
    if (existsInNpm(type)) {
      problems.push(...checkType(packageTypes, type));
    } else if (packageTypes.exportsByName.has(type.name)) {
      problems.push(`${type.name}: exported by npm, which the manifest leaves out`);
    }
  }

  const npmTypeNames = new Set(manifest.types.filter(existsInNpm).map((type) => type.name));

  for (const exportedName of packageTypes.exportsByName.keys()) {
    if (!npmTypeNames.has(exportedName)) {
      problems.push(`${exportedName}: exported by npm but not in the manifest`);
    }
  }

  return problems;
}

function withExtraMember(
  manifest: ShapeManifest,
  typeName: string,
  memberName: string,
): ShapeManifest {
  return {
    ...manifest,
    types: manifest.types.map((type) =>
      type.name === typeName
        ? { ...type, members: [...(type.members ?? []), { name: memberName }] }
        : type,
    ),
  };
}

function withMethodReturns(
  manifest: ShapeManifest,
  typeName: string,
  returns: string,
): ShapeManifest {
  return {
    ...manifest,
    types: manifest.types.map((type) =>
      type.name === typeName
        ? { ...type, methods: (type.methods ?? []).map((method) => ({ ...method, returns })) }
        : type,
    ),
  };
}

describe("hooks shape", () => {
  it("matches the shape manifest", () => {
    expect(checkHooksShape(readManifest())).toEqual([]);
  });

  it("names a member the package lacks", () => {
    const manifest = withExtraMember(readManifest(), "SignatureTemplate", "unlistedMember");

    expect(checkHooksShape(manifest)).toEqual(["SignatureTemplate.unlistedMember: missing in npm"]);
  });

  it("names a hook method whose return type differs", () => {
    const manifest = withMethodReturns(readManifest(), "AuthenticateHook", "Decision");

    expect(checkHooksShape(manifest)).toEqual([
      "AuthenticateHook.authenticate: npm returns AuthenticateResult, the manifest Decision",
    ]);
  });
});
