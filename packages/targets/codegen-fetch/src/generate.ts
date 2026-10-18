import {
  below,
  ExportNames,
  type GeneratedFile,
  type GenerateInput,
  type GenerateOutcome,
  operationLocation,
  type Refusal,
  refuseInconsistentIr,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
  typeScriptIdentifier,
} from "@seampact/codegen-core";
import type { ContractIR } from "@seampact/spec/ir";
import { deriveName } from "@seampact/spec/naming";
import {
  CLIENT_MODULE,
  type ClientOperation,
  clientModuleSource,
  MODULE_EXTENSION,
  RUNTIME_MODULE,
} from "./client-module.js";
import { planOperation } from "./operation-plan.js";
import type { FetchClientOptions } from "./options.js";
import { runtimeModuleSource } from "./runtime-module.js";
import { refuseFormatForms } from "./wire-format.js";

export const CLIENT_ARTEFACT = "client";

export type ClientArtefact = typeof CLIENT_ARTEFACT;

const RELATIVE_URLS = "relative";
const ABSOLUTE_URLS = "absolute";

// The client module and its runtime, or every refusal at once: a form the slice does not use is refused by name,
// never approximated (A47).
export function generateClient(
  input: GenerateInput<FetchClientOptions, ClientArtefact, "types">,
): GenerateOutcome {
  if (!input.artefacts.has(CLIENT_ARTEFACT)) return { status: "generated", files: [] };

  const { ir, links, options } = input;
  const refusals: Refusal[] = [];

  refuseApiForms(ir, refusals);

  const operations = clientOperations(ir, links.types.descriptor.operations, refusals);
  const uniqueRefusals = withoutRepeats(refusals);

  if (uniqueRefusals.length > 0) return { status: "refused", refusals: uniqueRefusals };

  const files: GeneratedFile[] = [
    { path: `${RUNTIME_MODULE}${MODULE_EXTENSION}`, contents: runtimeModuleSource() },
    {
      path: `${CLIENT_MODULE}${MODULE_EXTENSION}`,
      contents: `${clientModuleSource(operations, links.types, options.errorStyle)}\n`,
    },
  ];

  return { status: "generated", files };
}

function refuseApiForms(ir: ContractIR, refusals: Refusal[]): void {
  const urls = ir.api.wire.urls;
  const urlsLocation = below({ member: "" }, "api", "wire", "urls");

  if (urls === ABSOLUTE_URLS) {
    refusals.push(refuseNotGeneratedYet("wire.urls.absolute", "Absolute URLs", urlsLocation));
  } else if (urls !== RELATIVE_URLS) {
    refusals.push(refuseUnknownValueAt(urlsLocation, urls));
  }

  const usedFormats = new Set(ir.operations.map((operation) => operation.format));

  for (const formatId of [...usedFormats].sort()) {
    const format = Object.hasOwn(ir.formats, formatId) ? ir.formats[formatId] : undefined;

    if (format === undefined) {
      refusals.push(
        refuseInconsistentIr(
          "format.unresolved",
          `The format '${formatId}' is not declared`,
          below({ member: "" }, "formats", formatId),
        ),
      );
      continue;
    }

    refusals.push(...refuseFormatForms(format));
  }
}

function clientOperations(
  ir: ContractIR,
  typeExports: GenerateInput<
    FetchClientOptions,
    ClientArtefact,
    "types"
  >["links"]["types"]["descriptor"]["operations"],
  refusals: Refusal[],
): ClientOperation[] {
  const methodNames = new ExportNames(CLIENT_MODULE);

  return ir.operations.flatMap((operation, index) => {
    const location = operationLocation(index, operation.id);
    const methodName = typeScriptIdentifier(deriveName(operation.name.segments, "operation"));
    const types = Object.hasOwn(typeExports, operation.id) ? typeExports[operation.id] : undefined;
    const planned = planOperation(operation, ir, location, refusals);

    methodNames.claim(methodName, below(location, "name"), refusals);

    if (types === undefined) {
      refusals.push(
        refuseInconsistentIr(
          "link.types.operation.missing",
          "The types link has no types for this operation",
          location,
        ),
      );

      return [];
    }

    return [
      {
        id: operation.id,
        methodName,
        method: operation.method,
        path: operation.path,
        planned,
        types,
      },
    ];
  });
}

// A form shared by several operations, such as an error code's params, is refused once.
function withoutRepeats(refusals: readonly Refusal[]): Refusal[] {
  const seen = new Set<string>();

  return refusals.filter((refusal) => {
    const key = JSON.stringify([refusal.code, refusal.member, refusal.operation]);

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}
