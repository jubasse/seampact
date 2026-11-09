// The Next.js server target: a `routeHandler` function per api that places the shared request checks of
// `@seampact/server-runtime`, in their Web-standard profile, around the app's handler map in a Next.js 16 catch-all
// route, validating with zod.
export { target } from "./target.js";
