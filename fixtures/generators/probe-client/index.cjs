const { probeTarget } = require("../probe-common.cjs");

// No declaration kind is supported, so the IR support check refuses every contract.
exports.target = probeTarget({
  id: "probe-client",
  role: "client",
  kinds: [],
  artefacts: [
    { id: "queries", defaultOn: true },
    { id: "mutations", defaultOn: true, needs: ["queries"] },
  ],
  consumes: {
    client: { styles: ["fetch"] },
    types: { styles: ["typescript"], optional: { ownLibrary: "probe-types" } },
  },
  provides: {},
  importSpecifiers: "extensionless",
});
