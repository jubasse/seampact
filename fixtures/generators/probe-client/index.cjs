const { probeTarget } = require("../probe-common.cjs");

const definition = (kinds) =>
  probeTarget({
    id: "probe-client",
    role: "client",
    kinds,
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

const supporting = definition(["httpOperation"]);
const refusing = definition([]);

// `unsupportedKind: true` makes the IR support check refuse the contract: this twin then supports no declaration kind.
exports.target = {
  ...supporting,
  generate: (request) =>
    (request.options?.unsupportedKind === true ? refusing : supporting).generate(request),
};
