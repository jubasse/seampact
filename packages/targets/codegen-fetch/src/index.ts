// The fetch client target: one typed method per operation over the platform fetch, reading its request, success
// and error types from the `types` link and providing the `client` link the front targets consume. It also exports
// its generation and description, which the axios client target reuses.
export { describeClient } from "./describe.js";
export { CLIENT_ARTEFACT, type ClientArtefact, generateClient } from "./generate.js";
export type { FetchClientOptions } from "./options.js";
export { parseFetchClientOptions } from "./options.js";
export { target } from "./target.js";
