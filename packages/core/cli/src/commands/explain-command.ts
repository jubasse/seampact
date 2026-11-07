import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, printProblems } from "../cli-io.js";
import type { CliProblem } from "../cli-problem.js";
import { readAppConfig } from "../config/index.js";
import { type ApiRef, parseApiRef, sourcesHoldingRefs } from "./api-refs.js";
import { type CompiledApi, compileSources } from "./compile-sources.js";
import type { ConfigLocation } from "./config-location.js";
import { explainOperationText } from "./explain-view.js";

const OPERATION_SEPARATOR = ".";

// The operation `explain` names: `<api>.<operationId>`, the api as `<api>` or `<source>/<api>`, or the operation id
// alone when the sources hold one api.
interface ExplainTarget {
  readonly api?: ApiRef;
  readonly apiText?: string;
  readonly operationId: string;
}

// `seampact explain <api>.<operationId>`: compiles the sources that may hold the api, then prints the operation as
// YAML, each line commented with where it comes from (ADR 0002 section 16).
export async function explainCommand(
  location: ConfigLocation,
  operationText: string,
  io: CliIo,
): Promise<number> {
  const target = explainTarget(operationText);
  const read = await readAppConfig(location.file, location.displayName);

  if (read.status === "refused") return refuse(io, read.problems);

  const { config } = read;
  const names =
    target.apiText === undefined
      ? [...config.sources.keys()]
      : await sourcesHoldingRefs(config, [target.apiText]);
  const compiled = await compileSources(config, names, io);

  if (compiled.failed) return refuse(io, compiled.problems);

  const chosen = chosenApi(compiled.apis, target);

  if (chosen.status === "refused") return refuse(io, [chosen.problem]);

  const { ir, lintInput } = chosen.api;
  const operation = ir.operations.find((each) => each.id === target.operationId);

  if (operation === undefined) {
    const known = ir.operations.map((each) => each.id).sort();

    return refuse(io, [
      {
        code: "explain.operation.unknown",
        message: `The api '${chosen.api.api}' has no operation '${target.operationId}' (${known.join(", ") || "none"}).`,
        fix: "Name one of its operation ids, as the IR and the OpenAPI document spell it.",
      },
    ]);
  }

  io.stdout(explainOperationText(ir, operation, lintInput?.locations ?? {}));

  return EXIT_SUCCESS;
}

function explainTarget(text: string): ExplainTarget {
  const separator = text.lastIndexOf(OPERATION_SEPARATOR);

  if (separator === -1) return { operationId: text };

  const apiText = text.slice(0, separator);

  return { api: parseApiRef(apiText), apiText, operationId: text.slice(separator + 1) };
}

type ApiChoice =
  | { readonly status: "chosen"; readonly api: CompiledApi }
  | { readonly status: "refused"; readonly problem: CliProblem };

function chosenApi(apis: readonly CompiledApi[], target: ExplainTarget): ApiChoice {
  const ref = target.api;
  const candidates = apis.filter(
    (each) =>
      ref === undefined ||
      (each.api === ref.api && (ref.source === undefined || each.source === ref.source)),
  );
  const [only] = candidates;

  if (only !== undefined && candidates.length === 1) return { status: "chosen", api: only };

  const held = apis.map((each) => `'${each.source}/${each.api}'`).join(", ") || "none";

  if (only === undefined)
    return {
      status: "refused",
      problem: {
        code: "explain.api.unknown",
        message:
          target.apiText === undefined
            ? "The sources of the app config hold no api."
            : `No source of the app config holds an api '${target.apiText}'.`,
        fix: "Name an api of a source, as `<api>.<operationId>` or `<source>/<api>.<operationId>`.",
      },
    };

  if (ref === undefined)
    return {
      status: "refused",
      problem: {
        code: "explain.api.needed",
        message: `The sources hold several apis (${held}), so the operation id alone does not name one.`,
        fix: `Name the api: \`seampact explain <api>.${target.operationId}\`.`,
      },
    };

  return {
    status: "refused",
    problem: {
      code: "explain.api.ambiguous",
      message: `The api '${ref.api}' exists in several sources (${held}).`,
      fix: `Name it as \`<source>/${ref.api}.${target.operationId}\`.`,
    },
  };
}

function refuse(io: CliIo, problems: readonly CliProblem[]): number {
  printProblems(io, problems);

  return EXIT_REFUSED;
}
