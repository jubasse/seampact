import type { IrSupport } from "@seampact/spec/ir";
import { expectTypeOf, test } from "vitest";
import type { ValidatorsDescriptor } from "./descriptors.js";
import type { Link } from "./links.js";
import type {
  GenerateInput,
  GenerateOutcome,
  SourceFormat,
  TargetDefinition,
  TargetMetadata,
} from "./target.js";

const irSupport: IrSupport = {
  irVersions: [1],
  irRevision: 1,
  kinds: ["httpOperation"],
  features: [],
};

const format: SourceFormat = async (source) => source;

const noFiles = (): GenerateOutcome => ({ status: "generated", files: [] });

const validatorsMetadata: TargetMetadata<"schemas", never, "validators"> = {
  packageName: "@seampact/validators-example",
  packageVersion: "0.0.0",
  irSupport,
  artefacts: [{ id: "schemas", defaultOn: true }],
  consumes: [],
  provides: [{ kind: "validators", style: "standard-schema" }],
};

test("a consumer's generate input carries each link kind it consumes", () => {
  type ServerInput = GenerateInput<{ strict: boolean }, "routes", "validators" | "types">;

  expectTypeOf<ServerInput["links"]["validators"]>().toEqualTypeOf<Link<"validators">>();
  expectTypeOf<
    ServerInput["links"]["validators"]["descriptor"]
  >().toEqualTypeOf<ValidatorsDescriptor>();
  expectTypeOf<ServerInput["links"]>().not.toHaveProperty("client");
});

test("a provider definition must describe what it provides", () => {
  // @ts-expect-error a provider without `describe` is not a target definition
  const providerWithoutDescribe: TargetDefinition<object, "schemas", never, "validators"> = {
    metadata: validatorsMetadata,
    format,
    parseOptions: () => ({ status: "parsed", options: {} }),
    generate: noFiles,
  };

  expectTypeOf(providerWithoutDescribe).toHaveProperty("describe");
});
