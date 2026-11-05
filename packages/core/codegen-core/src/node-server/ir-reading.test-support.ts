import type { ContractIR } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import type { ClientDescriptor, GenerateOutcome, GenerateRequest, Target } from "../target.js";
import { readGoldenIr } from "./reference-project.test-support.js";

// The proofs of how a target reads the IR (ADR 0005 sections 2 and 3), shared by the client targets. The test names are
// the ones the proof file cites.

export interface IrReadingSubject {
  readonly target: Target;
  /** The request that generates the reference IR it is given, for the artefacts the target is run with. */
  readonly request: (ir: ContractIR) => GenerateRequest;
}

const REFERENCE_API = "tasks";
const UNSUPPORTED_IR_VERSION = 99;
const UNSUPPORTED_IR_REVISION = 9999;
const UNKNOWN_KIND = "futureKind";

/** The link to a fetch client whose operations are methods of their own id, for the front targets built on it. */
export function clientLinks(
  ir: ContractIR,
  errorStyle: ClientDescriptor["errorStyle"] = "result",
): GenerateRequest["links"] {
  const descriptor: ClientDescriptor = {
    kind: "client",
    style: "fetch",
    errorStyle,
    exports: {
      createClient: { module: "index", export: "createClient" },
      Client: { module: "index", export: "Client" },
      ContractError: { module: "index", export: "ContractError" },
      CallOptions: { module: "index", export: "CallOptions" },
    },
    operations: Object.fromEntries(
      ir.operations.map((operation) => [operation.id, { method: operation.id }]),
    ),
  };

  return { client: { descriptor, location: { kind: "relative", path: "../client" } } };
}

function generateFrom(subject: IrReadingSubject, ir: ContractIR): Promise<GenerateOutcome> {
  return subject.target.generate(subject.request(ir));
}

/** Registers the IR reading proofs of one client target. */
export function describeIrReadingProofs(subject: IrReadingSubject): void {
  describe("the IR the target reads", () => {
    test("an irVersion or irRevision outside what the target reads is refused by name", async () => {
      const ir = readGoldenIr(REFERENCE_API);
      const otherVersion = await generateFrom(
        subject,
        Object.assign({}, ir, { irVersion: UNSUPPORTED_IR_VERSION }),
      );
      const otherRevision = await generateFrom(
        subject,
        Object.assign({}, ir, { irRevision: UNSUPPORTED_IR_REVISION }),
      );

      expect(otherVersion).toMatchObject({
        status: "refused",
        refusals: [{ code: "ir.version.unsupported", message: expect.stringContaining("99") }],
      });
      expect(otherRevision).toMatchObject({
        status: "refused",
        refusals: [{ code: "ir.revision.mismatch", message: expect.stringContaining("9999") }],
      });
    });

    test("an unknown IR field is ignored and an unknown kind is refused by name", async () => {
      const ir = readGoldenIr(REFERENCE_API);
      const unchanged = await generateFrom(subject, ir);
      const withUnknownField = await generateFrom(
        subject,
        Object.assign({}, ir, { futureMember: { anything: true } }),
      );
      const withUnknownKind = await generateFrom(
        subject,
        Object.assign({}, ir, { kinds: [...ir.kinds, UNKNOWN_KIND] }),
      );

      expect(unchanged.status).toBe("generated");
      expect(withUnknownField).toEqual(unchanged);
      expect(withUnknownKind).toMatchObject({
        status: "refused",
        refusals: [{ code: "ir.kind.unsupported", message: expect.stringContaining(UNKNOWN_KIND) }],
      });
    });
  });
}
