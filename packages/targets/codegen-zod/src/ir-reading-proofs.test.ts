import { describeIrReadingProofs } from "@seampact/codegen-core/node-server/test-support";
import { target } from "./index.js";

describeIrReadingProofs({
  target,
  request: (ir) => ({ ir, options: {}, links: {}, artefacts: new Set(["validators"]) }),
});
