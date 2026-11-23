const { probeTarget } = require("../probe-common.cjs");

exports.target = probeTarget({
  id: "probe-server",
  role: "server",
  kinds: ["httpOperation"],
  artefacts: [
    { id: "routes", defaultOn: true },
    { id: "nativeDocs", defaultOn: false },
    { id: "hooks", defaultOn: false, needs: ["routes"], leftOffWithoutNeeds: true },
  ],
  consumes: {
    validators: {
      styles: ["standard-schema", "class-validator"],
      optional: { ownLibrary: "ajv" },
    },
  },
  provides: {},
  bootChecks: ["frameworkRoutes", "hooks"],
  frameworkDocsOffFix: "Remove the `probe.docs()` call.",
  exclusiveBasePaths: true,
  runtimePackages: ["probe-runtime"],
});
