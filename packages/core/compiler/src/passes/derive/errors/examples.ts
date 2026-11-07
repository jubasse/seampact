import { pipelinePointerBelow, pipelineTreeNodes } from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";
import { deriveErrorsEntries, deriveErrorsMember, deriveErrorsString } from "./read.js";
import type { DeriveErrorsContext, DeriveErrorsRegistry } from "./registry.js";
import type { DeriveErrorsReporter } from "./report.js";

// Route error examples (ADR 0002 section 12, ADR 0006 section 3): an example naming `error` holds the code's params
// in `value`. tree.nodes writes it unchecked; here the code must be registered and the value must fit its params,
// each issue located inside the value. A code without params takes no example, as for a declaration's example.

/** What the example check reads. */
export interface DeriveErrorsExampleCheck {
  readonly context: DeriveErrorsContext;
  readonly reporter: DeriveErrorsReporter;
  readonly registry: DeriveErrorsRegistry;
}

/** Checks the `error` examples of every route. */
export function deriveErrorsCheckRouteExamples(check: DeriveErrorsExampleCheck): void {
  for (const node of pipelineTreeNodes(check.context.raw))
    for (const [name, example] of deriveErrorsEntries(
      deriveErrorsMember(node.settings, "examples"),
    ))
      checkExample(check, example, pipelinePointerBelow(node.pointer, "examples", name));
}

function checkExample(
  check: DeriveErrorsExampleCheck,
  example: Parameters<typeof deriveErrorsString>[0],
  pointer: string,
): void {
  const code = deriveErrorsString(example, "error");

  if (code === undefined) return;

  const registered = check.registry.get(code);

  if (registered === undefined) {
    check.reporter.error({
      rule: "error-unknown",
      message: `the example names error code ${quote(code)}, which no layer or node declares and which is no default code`,
      fix: `declare ${quote(code)} with a status in 'errors', or name a declared code`,
      pointer: pipelinePointerBelow(pointer, "error"),
    });

    return;
  }

  const value = deriveErrorsMember(example, "value");
  const valuePointer = pipelinePointerBelow(pointer, "value");
  const params = registered.declaration.params;

  if (value === undefined) return;

  if (params === undefined) {
    check.reporter.error({
      rule: "error-example",
      message: `the example of error ${quote(code)} holds a value, but the code has no params for it to show`,
      fix: `declare params on ${quote(code)}, or remove the example`,
      pointer: valuePointer,
    });

    return;
  }

  for (const issue of check.context.treeSchemas.checkExample(value, {
    kind: "ref",
    schema: params,
  }))
    check.reporter.error({
      rule: "error-example",
      message: `the example of error ${quote(code)} does not fit its params: ${issue.message}`,
      fix: "correct the example to fit the params",
      pointer: `${valuePointer}${issue.pointer}`,
    });
}
