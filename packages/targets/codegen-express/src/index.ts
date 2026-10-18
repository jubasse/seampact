// The Express server target: a router per api that places the shared Node request checks of codegen-core around
// the app's handler map, on Express 4 and 5, validating with zod.
export { target } from "./target.js";
