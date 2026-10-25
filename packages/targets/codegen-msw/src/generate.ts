import {
  apiIndexSource,
  below,
  type GeneratedFile,
  type GenerateInput,
  type GenerateOutcome,
  type IndexedModule,
  operationLocation,
  planOperation,
  type Refusal,
  refuseFormatForms,
  refuseInconsistentIr,
  refuseNotGeneratedYet,
  withoutRepeats,
} from "@seampact/codegen-core";
import { mixedSegmentRefusals, operationIdentifier } from "@seampact/codegen-core/node-server";
import type { ContractIR } from "@seampact/spec/ir";
import { unescapableSegmentRefusals } from "./mock-path.js";
import { errorWritingsOf, mockPlanOf, refuseMissingTypes } from "./mock-plan.js";
import {
  HANDLERS_MEMBER,
  INDEX_MODULE,
  MOCKS_MODULE,
  MODULE_EXTENSION,
  type MockedOperation,
  mocksModuleSource,
  RUNTIME_MODULE,
} from "./mocks-module.js";
import type { MswMockOptions } from "./options.js";
import { runtimeModuleSource } from "./runtime-module.js";

export const HANDLERS_ARTEFACT = "handlers";

export type MswArtefact = typeof HANDLERS_ARTEFACT;

// The runtime's public names; its writing helpers stay private to the handlers.
const INDEXED_MODULES: readonly IndexedModule[] = [
  { module: MOCKS_MODULE },
  {
    module: RUNTIME_MODULE,
    typeNames: [
      "MockAnswer",
      "MockConfig",
      "MockErrorArguments",
      "MockReplyInit",
      "MockRequest",
      "MockResolver",
      "MockSuccessArguments",
      "OperationMocks",
    ],
    valueNames: ["MissingMockReply"],
  },
];

const RELATIVE_URLS = "relative";

// The mocks module and its runtime, or every refusal at once. The handlers answer what the fetch client reads, so a
// form the client refuses is refused here too, and a form the mock cannot write is refused by name (A47).
export function generateMocks(
  input: GenerateInput<MswMockOptions, MswArtefact, "types">,
): GenerateOutcome {
  if (!input.artefacts.has(HANDLERS_ARTEFACT)) return { status: "generated", files: [] };

  const { ir, links } = input;
  const refusals: Refusal[] = [...mixedSegmentRefusals(ir), ...unescapableSegmentRefusals(ir)];

  refuseApiForms(ir, refusals);

  const operations = mockedOperations(ir, links.types.descriptor.operations, refusals);
  const errorWritings = errorWritingsOf(
    ir,
    operations.map((operation) => operation.plan),
    refusals,
  );
  const uniqueRefusals = withoutRepeats(refusals);

  if (uniqueRefusals.length > 0) return { status: "refused", refusals: uniqueRefusals };

  const files: GeneratedFile[] = [
    { path: `${RUNTIME_MODULE}${MODULE_EXTENSION}`, contents: runtimeModuleSource() },
    {
      path: `${MOCKS_MODULE}${MODULE_EXTENSION}`,
      contents: `${mocksModuleSource(operations, errorWritings, links.types)}\n`,
    },
    { path: `${INDEX_MODULE}${MODULE_EXTENSION}`, contents: apiIndexSource(INDEXED_MODULES) },
  ];

  return { status: "generated", files };
}

function refuseApiForms(ir: ContractIR, refusals: Refusal[]): void {
  if (ir.api.wire.urls !== RELATIVE_URLS) {
    refusals.push(
      refuseNotGeneratedYet(
        "wire.urls.absolute",
        "Absolute URLs",
        below({ member: "" }, "api", "wire", "urls"),
      ),
    );
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

function mockedOperations(
  ir: ContractIR,
  typeExports: GenerateInput<
    MswMockOptions,
    MswArtefact,
    "types"
  >["links"]["types"]["descriptor"]["operations"],
  refusals: Refusal[],
): MockedOperation[] {
  return ir.operations.flatMap((operation, index) => {
    const location = operationLocation(index, operation.id);
    const member = operationIdentifier(operation);
    const types = Object.hasOwn(typeExports, operation.id) ? typeExports[operation.id] : undefined;
    const planned = planOperation(operation, ir, location, refusals);
    const plan = mockPlanOf(operation, member, planned, ir, location, refusals);

    if (member === HANDLERS_MEMBER) {
      refusals.push({
        code: "names.collision",
        message: `The operation's mock member '${member}' is the name of the list of every default handler.`,
        fix: "Rename the operation in the contract.",
        member: below(location, "name").member,
        operation: operation.id,
      });
    }

    if (types === undefined) {
      refusals.push(refuseMissingTypes(location));

      return [];
    }

    return [{ member, plan, types }];
  });
}
