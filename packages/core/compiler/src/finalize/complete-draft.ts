import { type Origin, walkIrInstance } from "@seampact/spec/ir";
import { loadFsReader, loadWorkspace } from "../load/index.js";
import { type DraftFixtureApi, draftFixture } from "../pipeline/draft-fixture.js";
import type { DraftIR, PipelineFinalizeContext } from "../pipeline/seam.js";
import type { RawApi } from "../raw-tree.js";

// Test support, outside every barrel: a complete draft of the reference contract for finalize's tests. It is the
// draft fixture after access (`fixtures/draft/reference/`) with stand-ins for the members of the derive halves,
// which are not in a fixture: each operation's `errors` (none) and `maturity`, each body's `bodyLimitBytes`, each
// concurrency's `derivedFrom`, and a core declaration for each error code the draft names. Beside it, the raw tree
// of the reference api, which finalize locates the draft's origins in.

const ERROR_CODE_DEFINITION = "ErrorCode";
const STAND_IN_BODY_LIMIT_BYTES = 1_048_576;
const STAND_IN_ERROR_STATUS = 400;

// The codes the draft names: by an error code member, or by the core origin of a code's params schema.
function namedErrorCodes(draft: DraftIR): Set<string> {
  const codes = new Set<string>();

  walkIrInstance(draft, (node) => {
    if (node.kind === "string" && node.definition === ERROR_CODE_DEFINITION) codes.add(node.value);

    if (node.kind !== "object" || node.definition !== "Origin") return;
    const { layer, pointer } = node.value;

    if (layer === "core" && typeof pointer === "string" && pointer.startsWith("/errors/"))
      codes.add(pointer.split("/")[2] ?? "");
  });

  return codes;
}

export function finalizeCompleteDraft(api: DraftFixtureApi): DraftIR {
  const draft = draftFixture(api, "after-access");

  for (const operation of draft.operations) {
    const origin: Origin | undefined = operation.origin;

    if (origin === undefined)
      throw new Error(`the draft fixture of ${api} has an operation with no origin`);
    operation.errors ??= [];
    operation.maturity ??= { level: "stable", source: "api", origin: { ...origin } };

    if (operation.input !== undefined) operation.input.bodyLimitBytes ??= STAND_IN_BODY_LIMIT_BYTES;

    if (operation.concurrency !== undefined)
      operation.concurrency.derivedFrom ??= {
        derivation: "concurrency.version",
        from: [{ ...origin }],
      };
  }

  for (const code of namedErrorCodes(draft)) {
    if (Object.hasOwn(draft.errors, code)) continue;

    draft.errors[code] = {
      code,
      nature: "refused",
      http: { status: STAND_IN_ERROR_STATUS },
      docs: {},
      origin: { layer: "core", pointer: `/errors/${code}` },
    };
  }

  return draft;
}

const reference = loadWorkspace({
  reader: loadFsReader(new URL("../../../../../fixtures/reference", import.meta.url).pathname),
  entry: "workspace.yaml",
});

export function finalizeReferenceRaw(api: DraftFixtureApi): RawApi {
  const raw = reference.workspace.apis.find((candidate) => candidate.name === api);

  if (raw === undefined) throw new Error(`the reference contract has no api ${api}`);

  return raw;
}

/** The finalize context of a reference api, whose `report` throws: these drafts give no diagnostic. */
export function finalizeReferenceContext(api: DraftFixtureApi): PipelineFinalizeContext {
  return {
    raw: finalizeReferenceRaw(api),
    report: (diagnostic) => {
      throw new Error(`finalize reported ${diagnostic.rule} on the reference draft of ${api}`);
    },
  };
}
