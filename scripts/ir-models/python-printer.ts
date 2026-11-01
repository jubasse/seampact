// A small line printer for the Python the IR model generator writes, laid out as `ruff format` lays it out: an
// expression stays on one line when it fits, otherwise its brackets open one item per line with a trailing comma,
// which ruff keeps as written (the magic trailing comma). Docstrings are wrapped to the same line length.

export const PYTHON_LINE_LENGTH = 120;
export const PYTHON_INDENT = "    ";

export type PythonExpression =
  | string
  | { call: string; arguments: PythonArgument[] }
  | { dict: [key: string, value: PythonExpression][] }
  | { tuple: PythonExpression[] };

export type PythonArgument = PythonExpression | { keyword: string; value: PythonExpression };

function isKeywordArgument(
  argument: PythonArgument,
): argument is { keyword: string; value: PythonExpression } {
  return typeof argument === "object" && "keyword" in argument;
}

function flatArgument(argument: PythonArgument): string {
  return isKeywordArgument(argument)
    ? `${argument.keyword}=${flatExpression(argument.value)}`
    : flatExpression(argument);
}

export function flatExpression(expression: PythonExpression): string {
  if (typeof expression === "string") return expression;

  if ("call" in expression)
    return `${expression.call}(${expression.arguments.map(flatArgument).join(", ")})`;

  if ("dict" in expression)
    return `{${expression.dict.map(([key, value]) => `${key}: ${flatExpression(value)}`).join(", ")}}`;

  const items = expression.tuple.map(flatExpression);

  return items.length === 1 ? `(${items[0]},)` : `(${items.join(", ")})`;
}

/** The lines of `head`, the expression and `tail` at `indent`, split at the outer brackets only when too long. */
export function renderExpression(
  expression: PythonExpression,
  indent: string,
  head: string,
  tail: string,
): string[] {
  const flat = `${indent}${head}${flatExpression(expression)}${tail}`;

  if (flat.length <= PYTHON_LINE_LENGTH || typeof expression === "string") return [flat];
  const inner = indent + PYTHON_INDENT;

  if ("call" in expression) {
    const items = expression.arguments.flatMap((argument) =>
      isKeywordArgument(argument)
        ? renderExpression(argument.value, inner, `${argument.keyword}=`, ",")
        : renderExpression(argument, inner, "", ","),
    );

    return [`${indent}${head}${expression.call}(`, ...items, `${indent})${tail}`];
  }

  if ("dict" in expression) {
    const items = expression.dict.flatMap(([key, value]) =>
      renderExpression(value, inner, `${key}: `, ","),
    );

    return [`${indent}${head}{`, ...items, `${indent}}${tail}`];
  }

  const items = expression.tuple.flatMap((item) => renderExpression(item, inner, "", ","));

  return [`${indent}${head}(`, ...items, `${indent})${tail}`];
}

/**
 * A Python string literal as ruff writes it: double quotes, or single quotes when the text holds more double
 * quotes than single ones.
 */
export function pythonString(value: string): string {
  const doubles = [...value].filter((character) => character === '"').length;
  const singles = [...value].filter((character) => character === "'").length;
  const quote = doubles > singles ? "'" : '"';
  let literal = "";

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;

    if (character === "\\") literal += "\\\\";
    else if (character === quote) literal += `\\${quote}`;
    else if (character === "\n") literal += "\\n";
    else if (character === "\t") literal += "\\t";
    else if (code < 0x20 || code === 0x7f) literal += `\\x${code.toString(16).padStart(2, "0")}`;
    else literal += character;
  }

  return `${quote}${literal}${quote}`;
}

// A docstring's text: a backslash is doubled and a run of three quotes broken, so the literal ends where it should.
function docstringText(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll('"""', '""\\"').trim();
}

/** A docstring wrapped at the line length: one line when it fits, else the closing quotes on their own line. */
export function docstringLines(text: string, indent: string): string[] {
  const escaped = docstringText(text);
  // Ruff keeps a quote off the closing delimiter with a space.
  const closing = escaped.endsWith('"') ? ' """' : '"""';
  const single = `${indent}"""${escaped}${closing}`;

  if (single.length <= PYTHON_LINE_LENGTH) return [single];

  const lines: string[] = [];
  let line = `${indent}"""`;
  let lineHasWord = false;

  for (const word of escaped.split(/\s+/)) {
    const candidate = lineHasWord ? `${line} ${word}` : `${line}${word}`;

    if (candidate.length > PYTHON_LINE_LENGTH && lineHasWord) {
      lines.push(line);
      line = `${indent}${word}`;
    } else {
      line = candidate;
    }

    lineHasWord = true;
  }

  // Ruff joins a docstring of one text line onto one line whatever its length, so the last word moves down.
  if (lines.length === 0) {
    const lastSpace = line.lastIndexOf(" ");

    return [line.slice(0, lastSpace), `${indent}${line.slice(lastSpace + 1)}`, `${indent}"""`];
  }

  return [...lines, line, `${indent}"""`];
}
