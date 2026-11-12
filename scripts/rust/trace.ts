import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export const CRATES_DIR = "crates";
export const TRACE_FILE = "trace.tsv";
export const XTASK_DIR = "xtask";

const NOT_PORTED = "-";
const SKIP_PREFIX = "skip: ";
const MERGED_PREFIX = "merged: ";
const FUNCTION_SEPARATOR = "#";
const COLUMN_SEPARATOR = "\t";
const PORTED_COLUMNS = 2;
const NOT_PORTED_COLUMNS = 3;

/** One line of a `trace.tsv`: where a TypeScript function went in the crate. */
interface TraceLine {
  lineNumber: number;
  rustPath: string;
  typeScriptFile: string;
  typeScriptFunction: string;
  /** The `skip:` or `merged:` column of a function not ported. */
  disposition: string | undefined;
}

/**
 * The functions of a TypeScript file, as the trace names them: top-level function
 * declarations, top-level consts bound to an arrow or a function expression (also behind
 * `satisfies`, `as` or parentheses), the methods of an object literal bound to a top-level
 * const as `const.method`, and class members as `Class.member` (methods, constructors,
 * accessors and function-valued properties). Nested closures are not listed.
 */
export function listTypeScriptFunctions(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false);
  const names: string[] = [];

  for (const statement of sourceFile.statements) {
    // An overload signature has no body; the implementation is listed once.
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      statement.body !== undefined
    ) {
      names.push(statement.name.text);
    }

    if (ts.isVariableStatement(statement)) {
      names.push(...functionConstNames(sourceFile, statement));
    }

    if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
      names.push(...classMethodNames(sourceFile, statement.name.text, statement));
    }
  }

  return names;
}

function functionConstNames(sourceFile: ts.SourceFile, statement: ts.VariableStatement): string[] {
  const names: string[] = [];

  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;

    const initializer = unwrapExpression(declaration.initializer);

    if (isFunctionValue(initializer)) names.push(declaration.name.text);

    if (ts.isObjectLiteralExpression(initializer)) {
      names.push(...memberNames(sourceFile, declaration.name.text, initializer.properties));
    }
  }

  return names;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isAsExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function isFunctionValue(expression: ts.Expression | undefined): boolean {
  if (expression === undefined) return false;

  const unwrapped = unwrapExpression(expression);

  return ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped);
}

function classMethodNames(
  sourceFile: ts.SourceFile,
  className: string,
  declaration: ts.ClassDeclaration,
): string[] {
  return memberNames(sourceFile, className, declaration.members);
}

/** `Owner.member` for each member with a body or a function value; a get and a set count once. */
function memberNames(
  sourceFile: ts.SourceFile,
  owner: string,
  members: ts.NodeArray<ts.ClassElement | ts.ObjectLiteralElementLike>,
): string[] {
  const names = new Set<string>();

  for (const member of members) {
    if (ts.isConstructorDeclaration(member)) {
      if (member.body !== undefined) names.add(`${owner}.constructor`);

      continue;
    }

    const hasBody =
      (ts.isMethodDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member)) &&
      member.body !== undefined;
    const hasFunctionValue =
      (ts.isPropertyDeclaration(member) || ts.isPropertyAssignment(member)) &&
      isFunctionValue(member.initializer);

    if (!hasBody && !hasFunctionValue) continue;

    const memberName = member.name;

    if (memberName === undefined) continue;

    names.add(
      `${owner}.${ts.isIdentifier(memberName) || ts.isPrivateIdentifier(memberName) ? memberName.text : memberName.getText(sourceFile)}`,
    );
  }

  return [...names];
}

/** The problems of every `crates/<crate>/trace.tsv` and of `xtask/trace.tsv` under `root`. */
export function checkTraces(root: string): string[] {
  const cratesRoot = join(root, CRATES_DIR);
  const crateNames = existsSync(cratesRoot)
    ? readdirSync(cratesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
  const directories = [...crateNames.map((name) => join(CRATES_DIR, name)), XTASK_DIR];
  const problems: string[] = [];

  for (const crateDirectory of directories) {
    const tracePath = join(root, crateDirectory, TRACE_FILE);

    if (!existsSync(tracePath)) continue;

    problems.push(...checkTraceFile(root, crateDirectory, readFileSync(tracePath, "utf8")));
  }

  return problems;
}

/** The problems of one crate's `trace.tsv`, its text given. */
export function checkTraceFile(root: string, crateDirectory: string, traceText: string): string[] {
  const traceName = `${crateDirectory}/${TRACE_FILE}`;
  const problems: string[] = [];
  const lines: TraceLine[] = [];

  traceText.split("\n").forEach((text, index) => {
    if (text === "") return;

    const parsed = parseTraceLine(text, index + 1);

    if (typeof parsed === "string") problems.push(`${traceName}:${index + 1}: ${parsed}`);
    else lines.push(parsed);
  });

  for (const line of lines) {
    for (const problem of checkRustTarget(root, crateDirectory, line)) {
      problems.push(`${traceName}:${line.lineNumber}: ${problem}`);
    }
  }

  problems.push(...checkTypeScriptCoverage(root, traceName, lines));

  return problems;
}

function parseTraceLine(text: string, lineNumber: number): TraceLine | string {
  const columns = text.split(COLUMN_SEPARATOR);
  const [rustPath = "", typeScriptReference = "", disposition] = columns;
  const expectedColumns = rustPath === NOT_PORTED ? NOT_PORTED_COLUMNS : PORTED_COLUMNS;

  if (columns.length !== expectedColumns) {
    return rustPath === NOT_PORTED
      ? "malformed line: a `-` line needs a third column, `skip: <reason>` or `merged: <rust path>`"
      : "malformed line: expected `<rust path>\\t<ts file>#<function>`";
  }

  // The first `#` splits: a private member is `Class.#name`.
  const separator = typeScriptReference.indexOf(FUNCTION_SEPARATOR);

  if (rustPath === "" || separator <= 0 || separator === typeScriptReference.length - 1) {
    return "malformed line: expected `<rust path>\\t<ts file>#<function>`";
  }

  if (disposition !== undefined && !isValidDisposition(disposition)) {
    return "malformed line: the third column is `skip: <reason>` or `merged: <rust path>`";
  }

  return {
    lineNumber,
    rustPath,
    typeScriptFile: typeScriptReference.slice(0, separator),
    typeScriptFunction: typeScriptReference.slice(separator + 1),
    disposition,
  };
}

function isValidDisposition(disposition: string): boolean {
  const prefix = [SKIP_PREFIX, MERGED_PREFIX].find((candidate) =>
    disposition.startsWith(candidate),
  );

  return prefix !== undefined && disposition.slice(prefix.length).trim() !== "";
}

/** The Rust paths a line names: its first column, or the target of a `merged:` line. */
function checkRustTarget(root: string, crateDirectory: string, line: TraceLine): string[] {
  const rustPaths: string[] = [];

  if (line.rustPath !== NOT_PORTED) rustPaths.push(line.rustPath);

  if (line.disposition?.startsWith(MERGED_PREFIX) === true) {
    rustPaths.push(line.disposition.slice(MERGED_PREFIX.length).trim());
  }

  return rustPaths.flatMap((rustPath) => missingRustItem(root, crateDirectory, rustPath));
}

/**
 * A Rust path is `<file relative to the crate>#<function>`, such as `src/load/reader.rs#read_file`;
 * the function is found by its `fn <name>` declaration at the start of a line of that file.
 */
function missingRustItem(root: string, crateDirectory: string, rustPath: string): string[] {
  // The first `#` splits: a raw identifier is `r#type`.
  const separator = rustPath.indexOf(FUNCTION_SEPARATOR);

  if (separator <= 0) {
    return [`Rust path \`${rustPath}\` is not \`<file relative to the crate>#<function>\``];
  }

  const rustFile = rustPath.slice(0, separator);
  const rustFunction = rustPath.slice(separator + 1);
  const absoluteFile = join(root, crateDirectory, rustFile);

  if (!existsSync(absoluteFile))
    return [`Rust file \`${crateDirectory}/${rustFile}\` does not exist`];

  const declaration = new RegExp(
    `^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:const\\s+)?(?:async\\s+)?fn\\s+${escapeRegExp(rustFunction)}\\s*[(<]`,
    "m",
  );

  if (!declaration.test(readFileSync(absoluteFile, "utf8"))) {
    return [
      `Rust function \`${rustFunction}\` is not declared in \`${crateDirectory}/${rustFile}\``,
    ];
  }

  return [];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every function of each named TypeScript file has exactly one line, and every line names one. */
function checkTypeScriptCoverage(root: string, traceName: string, lines: TraceLine[]): string[] {
  const problems: string[] = [];
  const linesByFile = new Map<string, TraceLine[]>();

  for (const line of lines) {
    const fileLines = linesByFile.get(line.typeScriptFile) ?? [];

    fileLines.push(line);
    linesByFile.set(line.typeScriptFile, fileLines);
  }

  for (const [typeScriptFile, fileLines] of linesByFile) {
    const absoluteFile = join(root, typeScriptFile);

    if (!existsSync(absoluteFile)) {
      problems.push(`${traceName}: TypeScript file \`${typeScriptFile}\` does not exist`);

      continue;
    }

    const functions = listTypeScriptFunctions(typeScriptFile, readFileSync(absoluteFile, "utf8"));
    const traced = new Set<string>();

    for (const line of fileLines) {
      if (!functions.includes(line.typeScriptFunction)) {
        problems.push(
          `${traceName}:${line.lineNumber}: \`${typeScriptFile}\` has no function \`${line.typeScriptFunction}\``,
        );
      }

      if (traced.has(line.typeScriptFunction)) {
        problems.push(
          `${traceName}:${line.lineNumber}: \`${typeScriptFile}#${line.typeScriptFunction}\` is traced twice`,
        );
      }

      traced.add(line.typeScriptFunction);
    }

    for (const functionName of functions) {
      if (!traced.has(functionName)) {
        problems.push(`${traceName}: \`${typeScriptFile}#${functionName}\` has no line`);
      }
    }
  }

  return problems;
}
