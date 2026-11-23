const { probeTarget } = require("../probe-common.cjs");

exports.target = probeTarget({
  id: "probe-provider",
  role: "provider",
  kinds: ["httpOperation"],
  artefacts: [],
  consumes: {},
  provides: {
    validators: { style: "standard-schema" },
    types: { style: "typescript" },
    client: { style: "fetch" },
  },
  provider: true,
});
