import {
  describeIrReadingProofs,
  typesLinks,
} from "@seampact/codegen-core/node-server/test-support";
import { target } from "./index.js";

describeIrReadingProofs({
  target,
  request: (ir) => ({
    ir,
    options: {},
    links: typesLinks(ir),
    artefacts: new Set(["client"]),
  }),
});
