// The Fastify server target: an encapsulated plugin per api that places the shared Node request checks of
// codegen-core around the app's handler map, on Fastify 5, validating with a validators link or with Ajv.
export { target } from "./target.js";
