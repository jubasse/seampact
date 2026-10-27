// The Express server target: a router per api that places the shared Node request checks of
// `@seampact/server-runtime` around the app's handler map, on Express 4 and 5, validating with zod.
export { target } from "./target.js";
