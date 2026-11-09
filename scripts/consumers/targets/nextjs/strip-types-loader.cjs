// A webpack loader that turns an `.mts` source into JavaScript by stripping its types with Node's own
// `stripTypeScriptTypes`: Next.js compiles `.ts` and `.tsx` only, and the sample app's sources are `.mts`.
const { stripTypeScriptTypes } = require("node:module");

module.exports = function stripTypesLoader(source) {
  return stripTypeScriptTypes(source);
};
