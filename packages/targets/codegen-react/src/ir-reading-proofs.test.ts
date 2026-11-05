import {
  clientLinks,
  describeIrReadingProofs,
} from "@seampact/codegen-core/node-server/test-support";
import { target } from "./target.js";

describeIrReadingProofs({
  target,
  request: (ir) => ({
    ir,
    options: { query: "tanstack" },
    links: clientLinks(ir),
    artefacts: new Set(["queries", "hooks"]),
  }),
});
