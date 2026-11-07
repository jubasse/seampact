// The Hono server target: a `registerRoutes` function per api that places the shared request checks of
// `@seampact/server-runtime`, in their Web-standard profile, around the app's handler map on Hono 4, validating
// with zod.
export { target } from "./target.js";
